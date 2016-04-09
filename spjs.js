var is_volume;

(function($) {
	"use strict";

	if('undefined' === typeof $) {
		if('console' in window){ window.console.info('Too much lightness, Featherlight needs jQuery.'); }
		return;
	}

	function Featherlight($content, config) {
		if(this instanceof Featherlight) {  /* called with new */
			this.id = Featherlight.id++;
			this.setup($content, config);
			this.chainCallbacks(Featherlight._callbackChain);
		} else {
			var fl = new Featherlight($content, config);
			fl.open();
			return fl;
		}
	}

	var opened = [],
		pruneOpened = function(remove) {
			opened = $.grep(opened, function(fl) {
				return fl !== remove && fl.$instance.closest('body').length > 0;
			} );
			return opened;
		};

	// structure({iframeMinHeight: 44, foo: 0}, 'iframe')
	//   #=> {min-height: 44}
	var structure = function(obj, prefix) {
		var result = {},
			regex = new RegExp('^' + prefix + '([A-Z])(.*)');
		for (var key in obj) {
			var match = key.match(regex);
			if (match) {
				var dasherized = (match[1] + match[2].replace(/([A-Z])/g, '-$1')).toLowerCase();
				result[dasherized] = obj[key];
			}
		}
		return result;
	};

	/* document wide key handler */
	var eventMap = { keyup: 'onKeyUp', resize: 'onResize' };

	var globalEventHandler = function(event) {
		$.each(Featherlight.opened().reverse(), function() {
			if (!event.isDefaultPrevented()) {
				if (false === this[eventMap[event.type]](event)) {
					event.preventDefault(); event.stopPropagation(); return false;
			  }
			}
		});
	};

	var toggleGlobalEvents = function(set) {
			if(set !== Featherlight._globalHandlerInstalled) {
				Featherlight._globalHandlerInstalled = set;
				var events = $.map(eventMap, function(_, name) { return name+'.'+Featherlight.prototype.namespace; } ).join(' ');
				$(window)[set ? 'on' : 'off'](events, globalEventHandler);
			}
		};

	Featherlight.prototype = {
		constructor: Featherlight,
		/*** defaults ***/
		/* extend featherlight with defaults and methods */
		namespace:    'featherlight',         /* Name of the events and css class prefix */
		targetAttr:   'data-featherlight',    /* Attribute of the triggered element that contains the selector to the lightbox content */
		variant:      null,                   /* Class that will be added to change look of the lightbox */
		resetCss:     false,                  /* Reset all css */
		background:   null,                   /* Custom DOM for the background, wrapper and the closebutton */
		openTrigger:  'click',                /* Event that triggers the lightbox */
		closeTrigger: 'click',                /* Event that triggers the closing of the lightbox */
		filter:       null,                   /* Selector to filter events. Think $(...).on('click', filter, eventHandler) */
		root:         'body',                 /* Where to append featherlights */
		openSpeed:    250,                    /* Duration of opening animation */
		closeSpeed:   250,                    /* Duration of closing animation */
		closeOnClick: 'background',           /* Close lightbox on click ('background', 'anywhere' or false) */
		closeOnEsc:   true,                   /* Close lightbox when pressing esc */
		closeIcon:    '&#10005;',             /* Close icon */
		loading:      '<img src="http://files.owlch.ru/images/loading.gif" alt="" />',                     /* Content to show while initial content is loading */
		persist:      false,									/* If set, the content persist and will be shown again when opened again. 'shared' is a special value when binding multiple elements for them to share the same content */
		otherClose:   null,                   /* Selector for alternate close buttons (e.g. "a.close") */
		beforeOpen:   $.noop,                 /* Called before open. can return false to prevent opening of lightbox. Gets event as parameter, this contains all data */
		beforeContent: $.noop,                /* Called when content is loaded. Gets event as parameter, this contains all data */
		beforeClose:  $.noop,                 /* Called before close. can return false to prevent opening of lightbox. Gets event as parameter, this contains all data */
		afterOpen:    $.noop,                 /* Called after open. Gets event as parameter, this contains all data */
		afterContent: $.noop,                 /* Called after content is ready and has been set. Gets event as parameter, this contains all data */
		afterClose:   $.noop,                 /* Called after close. Gets event as parameter, this contains all data */
		onKeyUp:      $.noop,                 /* Called on key down for the frontmost featherlight */
		onResize:     $.noop,                 /* Called after new content and when a window is resized */
		type:         null,                   /* Specify type of lightbox. If unset, it will check for the targetAttrs value. */
		contentFilters: ['jquery', 'image', 'html', 'ajax', 'iframe', 'text'], /* List of content filters to use to determine the content */

		/*** methods ***/
		/* setup iterates over a single instance of featherlight and prepares the background and binds the events */
		setup: function(target, config){
			/* all arguments are optional */
			if (typeof target === 'object' && target instanceof $ === false && !config) {
				config = target;
				target = undefined;
			}

			var self = $.extend(this, config, {target: target}),
				css = !self.resetCss ? self.namespace : self.namespace+'-reset', /* by adding -reset to the classname, we reset all the default css */
				$background = $(self.background || [
					'<div class="'+css+'-loading '+css+'">',
						'<div class="'+css+'-content">',
							'<span class="'+css+'-close-icon '+ self.namespace + '-close">',
								self.closeIcon,
							'</span>',
							'<div class="'+self.namespace+'-inner">' + self.loading + '</div>',
						'</div>',
					'</div>'].join('')),
				closeButtonSelector = '.'+self.namespace+'-close' + (self.otherClose ? ',' + self.otherClose : '');

			self.$instance = $background.clone().addClass(self.variant); /* clone DOM for the background, wrapper and the close button */

			/* close when click on background/anywhere/null or closebox */
			self.$instance.on(self.closeTrigger+'.'+self.namespace, function(event) {
				var $target = $(event.target);
				if( ('background' === self.closeOnClick  && $target.is('.'+self.namespace))
					|| 'anywhere' === self.closeOnClick
					|| $target.closest(closeButtonSelector).length ){
					event.preventDefault();
					self.close();
				}
			});

			return this;
		},

		/* this method prepares the content and converts it into a jQuery object or a promise */
		getContent: function(){
			if(this.persist !== false && this.$content) {
				return this.$content;
			}
			var self = this,
				filters = this.constructor.contentFilters,
				readTargetAttr = function(name){ return self.$currentTarget && self.$currentTarget.attr(name); },
				targetValue = readTargetAttr(self.targetAttr),
				data = self.target || targetValue || '';

			/* Find which filter applies */
			var filter = filters[self.type]; /* check explicit type like {type: 'image'} */

			/* check explicit type like data-featherlight="image" */
			if(!filter && data in filters) {
				filter = filters[data];
				data = self.target && targetValue;
			}
			data = data || readTargetAttr('href') || '';

			/* check explicity type & content like {image: 'photo.jpg'} */
			if(!filter) {
				for(var filterName in filters) {
					if(self[filterName]) {
						filter = filters[filterName];
						data = self[filterName];
					}
				}
			}

			/* otherwise it's implicit, run checks */
			if(!filter) {
				var target = data;
				data = null;
				$.each(self.contentFilters, function() {
					filter = filters[this];
					if(filter.test)  {
						data = filter.test(target);
					}
					if(!data && filter.regex && target.match && target.match(filter.regex)) {
						data = target;
					}
					return !data;
				});
				if(!data) {
					if('console' in window){ window.console.error('Featherlight: no content filter found ' + (target ? ' for "' + target + '"' : ' (no target specified)')); }
					return false;
				}
			}
			/* Process it */
			return filter.process.call(self, data);
		},

		/* sets the content of $instance to $content */
		setContent: function($content){
			var self = this;
			/* we need a special class for the iframe */
			if($content.is('iframe') || $('iframe', $content).length > 0){
				self.$instance.addClass(self.namespace+'-iframe');
			}

			self.$instance.removeClass(self.namespace+'-loading');

			/* replace content by appending to existing one before it is removed
			   this insures that featherlight-inner remain at the same relative
				 position to any other items added to featherlight-content */
			self.$instance.find('.'+self.namespace+'-inner')
				.not($content)                /* excluded new content, important if persisted */
				.slice(1).remove().end()			/* In the unexpected event where there are many inner elements, remove all but the first one */
				.replaceWith($.contains(self.$instance[0], $content[0]) ? '' : $content);

			self.$content = $content.addClass(self.namespace+'-inner');

			return self;
		},

		/* opens the lightbox. "this" contains $instance with the lightbox, and with the config.
			Returns a promise that is resolved after is successfully opened. */
		open: function(event){
			var self = this;
			self.$instance.hide().appendTo(self.root);
			if((!event || !event.isDefaultPrevented())
				&& self.beforeOpen(event) !== false) {

				if(event){
					event.preventDefault();
				}
				var $content = self.getContent();

				if($content) {
					opened.push(self);

					toggleGlobalEvents(true);

					self.$instance.fadeIn(self.openSpeed);
					self.beforeContent(event);

					/* Set content and show */
					return $.when($content)
						.always(function($content){
							self.setContent($content);
							self.afterContent(event);
						})
						.then(self.$instance.promise())
						/* Call afterOpen after fadeIn is done */
						.done(function(){ self.afterOpen(event); });
				}
			}
			self.$instance.detach();
			return $.Deferred().reject().promise();
		},

		/* closes the lightbox. "this" contains $instance with the lightbox, and with the config
			returns a promise, resolved after the lightbox is successfully closed. */
		close: function(event){
			var self = this,
				deferred = $.Deferred();

			if(self.beforeClose(event) === false) {
				deferred.reject();
			} else {

				if (0 === pruneOpened(self).length) {
					toggleGlobalEvents(false);
				}

				self.$instance.fadeOut(self.closeSpeed,function(){
					self.$instance.detach();
					self.afterClose(event);
					deferred.resolve();
				});
			}
			return deferred.promise();
		},

		/* Utility function to chain callbacks
		   [Warning: guru-level]
		   Used be extensions that want to let users specify callbacks but
		   also need themselves to use the callbacks.
		   The argument 'chain' has callback names as keys and function(super, event)
		   as values. That function is meant to call `super` at some point.
		*/
		chainCallbacks: function(chain) {
			for (var name in chain) {
				this[name] = $.proxy(chain[name], this, $.proxy(this[name], this));
			}
		}
	};

	$.extend(Featherlight, {
		id: 0,                                    /* Used to id single featherlight instances */
		autoBind:       '[data-featherlight]',    /* Will automatically bind elements matching this selector. Clear or set before onReady */
		defaults:       Featherlight.prototype,   /* You can access and override all defaults using $.featherlight.defaults, which is just a synonym for $.featherlight.prototype */
		/* Contains the logic to determine content */
		contentFilters: {
			jquery: {
				regex: /^[#.]\w/,         /* Anything that starts with a class name or identifiers */
				test: function(elem)    { return elem instanceof $ && elem; },
				process: function(elem) { return this.persist !== false ? $(elem) : $(elem).clone(true); }
			},
			image: {
			regex: /\.(png|jpg|jpeg|gif|tiff|bmp|svg|webm|swf|.*)(\?\S*)?$/i,
				process: function(url)  {
				window.is_volume = window.PLAYER.getVolume(get_val);
					var m5 = url.split(".").pop();
					if (m5.match(/webm/g)) { window.PLAYER.setVolume(0);
				var m_end = "<div class=\"webm-source\"><video controls name=\"media\" class=\"webm-media\"><source src=\""+url+"\" type=\"video/webm\"></video></div>";
				} else if (m5.match(/swf/g)) { window.PLAYER.setVolume(0);
				var m_end = "<div class=\"webm-source\"><object type=\"application/x-shockwave-flash\" width=\"820\" height=\"480\" data=\""+url+"\"><param name=\"movie\" value=\""+url+"\"><PARAM NAME=\"SCALE\" VALUE=\"default\"></object></div>";			
				} else {
				var m_end = "<a href=\""+url+"\" target=\"_blank\"><img src=\""+url+"\" alt=\"\" class=\"featherlight-image\" /></a>";
				}
                                if (url.match(/youtube\.com/g)) {
                                var m_end = "<iframe src=\"" + url + "\" frameborder=\"0\" width=\"864\" height=\"486\" allowfullscreen>ааАб аБбаАбаЗаЕб аНаЕ аПаОаДаДаЕбаЖаИаВаАаЕб IFRAME!</iframe>";
				window.PLAYER.setVolume(0);
                                }
						var self = this,
						deferred = $.Deferred(),
						img = new Image(),
						$img = $(m_end);
					img.onload  = function() {
						/* Store naturalWidth & height for IE8 */
						$img.naturalWidth = img.width; $img.naturalHeight = img.height;
						deferred.resolve( $img );
					};
					img.onerror = function() { deferred.reject($img); };
					img.src = url;
					return deferred.promise();
				}
			},
			html: {
				regex: /^\s*<[\w!][^<]*>/, /* Anything that starts with some kind of valid tag */
				process: function(html) { return $(html); }
			},
			ajax: {
				regex: /./,            /* At this point, any content is assumed to be an URL */
				process: function(url)  {
					var self = this,
						deferred = $.Deferred();
					/* we are using load so one can specify a target with: url.html #targetelement */
					var $container = $('<div></div>').load(url, function(response, status){
						if ( status !== "error" ) {
							deferred.resolve($container.contents());
						}
						deferred.fail();
					});
					return deferred.promise();
				}
			},
			iframe: {
				process: function(url) {
					var deferred = new $.Deferred();
					var $content = $('<iframe/>')
						.hide()
						.attr('src', url)
						.css(structure(this, 'iframe'))
						.on('load', function() { deferred.resolve($content.show()); })
						// We can't move an <iframe> and avoid reloading it,
						// so let's put it in place ourselves right now:
						.appendTo(this.$instance.find('.' + this.namespace + '-content'));
					return deferred.promise();
				}
			},
			text: {
				process: function(text) { return $('<div>', {text: text}); }
			}
		},

		functionAttributes: ['beforeOpen', 'afterOpen', 'beforeContent', 'afterContent', 'beforeClose', 'afterClose'],

		/*** class methods ***/
		/* read element's attributes starting with data-featherlight- */
		readElementConfig: function(element, namespace) {
			var Klass = this,
				regexp = new RegExp('^data-' + namespace + '-(.*)'),
				config = {};
			if (element && element.attributes) {
				$.each(element.attributes, function(){
					var match = this.name.match(regexp);
					if (match) {
						var val = this.value,
							name = $.camelCase(match[1]);
						if ($.inArray(name, Klass.functionAttributes) >= 0) {  /* jshint -W054 */
							val = new Function(val);                           /* jshint +W054 */
						} else {
							try { val = $.parseJSON(val); }
							catch(e) {}
						}
						config[name] = val;
					}
				});
			}
			return config;
		},

		/* Used to create a Featherlight extension
		   [Warning: guru-level]
		   Creates the extension's prototype that in turn
		   inherits Featherlight's prototype.
		   Could be used to extend an extension too...
		   This is pretty high level wizardy, it comes pretty much straight
		   from CoffeeScript and won't teach you anything about Featherlight
		   as it's not really specific to this library.
		   My suggestion: move along and keep your sanity.
		*/
		extend: function(child, defaults) {
			/* Setup class hierarchy, adapted from CoffeeScript */
			var Ctor = function(){ this.constructor = child; };
			Ctor.prototype = this.prototype;
			child.prototype = new Ctor();
			child.__super__ = this.prototype;
			/* Copy class methods & attributes */
			$.extend(child, this, defaults);
			child.defaults = child.prototype;
			return child;
		},

		attach: function($source, $content, config) {
			var Klass = this;
			if (typeof $content === 'object' && $content instanceof $ === false && !config) {
				config = $content;
				$content = undefined;
			}
			/* make a copy */
			config = $.extend({}, config);

			/* Only for openTrigger and namespace... */
			var namespace = config.namespace || Klass.defaults.namespace,
				tempConfig = $.extend({}, Klass.defaults, Klass.readElementConfig($source[0], namespace), config),
				sharedPersist;

			$source.on(tempConfig.openTrigger+'.'+tempConfig.namespace, tempConfig.filter, function(event) {
				/* ... since we might as well compute the config on the actual target */
				var elemConfig = $.extend(
					{$source: $source, $currentTarget: $(this)},
					Klass.readElementConfig($source[0], tempConfig.namespace),
					Klass.readElementConfig(this, tempConfig.namespace),
					config);
				var fl = sharedPersist || $(this).data('featherlight-persisted') || new Klass($content, elemConfig);
				if(fl.persist === 'shared') {
					sharedPersist = fl;
				} else if(fl.persist !== false) {
					$(this).data('featherlight-persisted', fl);
				}
				elemConfig.$currentTarget.blur(); // Otherwise 'enter' key might trigger the dialog again
				fl.open(event);
			});
			return $source;
		},

		current: function() {
			var all = this.opened();
			return all[all.length - 1] || null;
		},

		opened: function() {
			var klass = this;
			pruneOpened();
			return $.grep(opened, function(fl) { return fl instanceof klass; } );
		},

		close: function() {
			var cur = this.current();
			if(cur) { return cur.close(); }
		},

		/* Does the auto binding on startup.
		   Meant only to be used by Featherlight and its extensions
		*/
		_onReady: function() {
			var Klass = this;
			if(Klass.autoBind){
				/* First, bind click on document, so it will work for items added dynamically */
				Klass.attach($(document), {filter: Klass.autoBind});
				/* Auto bound elements with attr-featherlight-filter won't work
				   (since we already used it to bind on document), so bind these
				   directly. We can't easily support dynamically added element with filters */
				$(Klass.autoBind).filter('[data-featherlight-filter]').each(function(){
					Klass.attach($(this));
				});
			}
		},

		/* Featherlight uses the onKeyUp callback to intercept the escape key.
		   Private to Featherlight.
		*/
		_callbackChain: {
			onKeyUp: function(_super, event){
				if(27 === event.keyCode) {
					if (this.closeOnEsc) {
						this.$instance.find('.'+this.namespace+'-close:first').click();
					}
					return false;
				} else {
					return _super(event);
				}
			},

			onResize: function(_super, event){
				if (this.$content.naturalWidth) {
					var w = this.$content.naturalWidth, h = this.$content.naturalHeight;
					/* Reset apparent image size first so container grows */
					this.$content.css('width', '').css('height', '');
					/* Calculate the worst ratio so that dimensions fit */
					var ratio = Math.max(
						w  / parseInt(this.$content.parent().css('width'),10),
						h / parseInt(this.$content.parent().css('height'),10));
					/* Resize content */
					if (ratio > 1) {
						this.$content.css('width', '' + w / ratio + 'px').css('height', '' + h / ratio + 'px');
					}
				}
				return _super(event);
			},

			afterContent: function(_super, event){
				var r = _super(event);
				this.onResize(event);
				return r;
			}
		}
	});

	$.featherlight = Featherlight;

	/* bind jQuery elements to trigger featherlight */
	$.fn.featherlight = function($content, config) {
		return Featherlight.attach(this, $content, config);
	};

	/* bind featherlight on ready if config autoBind is set */
	$(document).ready(function(){ Featherlight._onReady(); });
}(jQuery));

function get_val(val) { return val; }

function chatMsgManager (e) {
if(e.keyCode === 13 || e.target.id == "chatbtn") {
if (window.CHATTHROTTLE) { return; }
var msg = $("#chatline").val().trim();
if(msg !== '') { var meta = {};

if (USEROPTS.modhat == true && USEROPTS.adminhat != true) {
meta.modflair = CLIENT.rank;
}

socket.emit("chatMsg", {msg: msg, meta: meta});
if (msg == "!skip") {
if (CHANNEL.opts.allow_voteskip === true) {
socket.emit("voteskip"); socket.emit("chatMsg", {msg: "тЅ абаДаАаН аГаОаЛаОб аЗаА аПбаОаПббаК аВаИаДаЕаО", meta: meta}); 
} else {
socket.emit("chatMsg", {msg: "тЅ аЁаКаИаПаЛаОаК аАаКбаИаВаИбаОаВаАаН. ааЕаЙббаВаИаЕ аНаЕаВаОаЗаМаОаЖаНаО.", meta: meta});
}

}
else if (msg == "!time") { date = new Date(); 
var min = ("0" + date.getMinutes()).substr(-2);
socket.emit("chatMsg", { msg: "тЅ аЂаЕаКббаЕаЕ аВбаЕаМб: " + date.getHours() + ":" + min, meta: meta}); }
else if (msg == "!inba") {
function inba() {
                var IMBA = new Audio("http://files.owlch.ru/inba.ogg");
                IMBA.volume = 0.7;
                IMBA.play();
                var BGCHANGE = 0;
                var inbix = setInterval(function() {
                    $("body").css('background-image', 'none');
                    BGCHANGE++;
 if (BGCHANGE % 2 === 0) {$("body").css('background-color', 'red'); } else {$("body").css('background-color', 'blue'); }
                }, 200);
                setTimeout(function() {
                    BGCHANGE = 0;
                    clearInterval(inbix);
                    $("body").css({'background-image':'', 'background-color':''});
                    $yoba.remove();
                }, 12000);

                var smilesArray = window.CHANNEL.emotes.map(function (smile) {
                    return smile.name;
                });
socket.emit("chatMsg", { msg: "dance", meta: meta}); 
                return smilesArray[Math.floor(Math.random() * smilesArray.length)] + ' ';
            }
inba();
}
CHATHIST.push($("#chatline").val());
CHATHISTIDX = CHATHIST.length;
$("#chatline").val('');
}
return;
} else if(e.keyCode === 9) {
chatTabComplete();
e.preventDefault();
return false;
} else if(e.keyCode === 38) {
if(CHATHISTIDX === CHATHIST.length) {
CHATHIST.push($("#chatline").val());
}
if(CHATHISTIDX > 0) {
CHATHISTIDX--;
$("#chatline").val(CHATHIST[CHATHISTIDX]);
}
e.preventDefault();
return false;
} else if(e.keyCode === 40) {
if(CHATHISTIDX < CHATHIST.length - 1) {
CHATHISTIDX++;
$("#chatline").val(CHATHIST[CHATHISTIDX]);
} e.preventDefault(); return false; }};


$(document).ready( function() {
$(document).on('click', '#fl-content', function() { $(".featherlight-content").draggable();});
$(document).on('click', '.featherlight-close-icon', function() { window.PLAYER.setVolume(window.is_volume); });
$(document).on('click', '.featherlight', function() { window.PLAYER.setVolume(window.is_volume); });
$('#chatline, #chatbtn').off();
$('#chatbtn').on('click', function (e){chatMsgManager(e);});
$('#chatline').on('keydown', function (e){chatMsgManager(e);});
});


document.addEventListener('DOMContentLoaded', function () {
  if (Notification.permission !== "granted") { Notification.requestPermission(); }
});

function notifyMe(user, msg, url) {
  if (!Notification) { return; }
  if (Notification.permission !== "granted")  Notification.requestPermission(); 
 else {

msg = msg.replace(/<img class="channel-emote" src=".*?" title="(.*?)">/g, "$1");
msg = msg.replace(/<a href="#" id="fl-content" data-featherlight="(.*?)"><img class="image-embed-small" src=".*?" \/><\/a>/g, "$1");
msg = msg.replace(/<a href="#" id="fl-content" data-featherlight="(.*?)"><img src=".*?" class=".*?"><\/a>/g,"$1");
msg = msg.replace(/<a href="#" data-featherlight="(.*?)"><img class="image-embed-small" src=".*?" \/><\/a>/g, "$1");
msg = msg.replace(/<a href="(.*?)" target="_blank">(.*?)<\/a>/g, "$2");

    tag = url.split('/');
    var notification = new Notification('аЁаОаОаБбаЕаНаИаЕ аОб ' + user + " аВ /" + tag[tag.length-2] + "/" + tag[tag.length-1], {
      icon: 'http://files.owlch.ru/images/notify_owl2.png',
      body: msg,
    });

notification.onclick = function () { window.open(url);}; }
setTimeout(function(){ notification.close();}, 6500);
}

$(document).ready(function() {
NotifyOwlch();

function NotifyOwlch() {
socket.on("pm", function(datapm) { 
var url = window.location.href;
var user = datapm.username;
var message = datapm.msg;

if (user != CLIENT.name && IGNORED.indexOf(user)) {
notifyMe(user, message, url); 
}
 });
}
});


function closeOverlay() {
$('#xoverlay').css('display', 'none');
$('#xmodal_form').css('display', 'none');
}

function get_info(entry) {
leader = entry.data("leader");
return;
}

function doitfor(user, method) {
var chatline_pre = $('#chatline').val();
if (method == "kick") {
var command = '/kick ' + user;
} else if (method == "banOnName") {
var command = '/ban ' + user;
} else if (method == "banOnIP") {
var command = '/ipban ' + user;
} else if (method == "cleanVideos") {
var command = '/clean ' + user;
} else if (method == "mute") {
var command = '/mute ' + user;
} else if (method == "smute") {
var command = '/smute ' + user;
} else if (method == "unmute") {
var command = '/unmute ' + user;
} else if (method == "unban") {
var command = '!unban ' + user;
} else if (method == 'giveLeader') {
if (hasPermission("leaderctl")) {

var users = $("#userlist").children();
for(var i = 0; i < users.length; i++) {
get_info($(users[i]));
}
if (!leader) {
socket.emit("assignLeader", { name: user});
} else {
socket.emit("assignLeader", { name: ""});
}
 }
  } //end method
$('#chatline').val(command);
$('#chatline').trigger(jQuery.Event('keydown', {keyCode: 13}))
$('#chatline').val(chatline_pre);

$('#xmodal_form').animate({opacity: 0}, 50, function(){ $(this).css('display', 'none'); $('#xoverlay').fadeOut(50);});
 }

var listblock = function(event) { event.preventDefault(); }

$(document).mousedown(function (event) {
        if ($(event.target).attr('class') != 'username' && $(event.target).attr('class') != 'server-whisper' && event.button == 2) {
         document.removeEventListener('contextmenu', listblock, false);

        }
    });

$('#motdwrap').prepend('<div id="xmodal_form" style="display: none;"></div><div id="xoverlay" onclick="closeOverlay()"></div>');

function modmenu(username, event) {
if (window.hasPermission("chatclear")) {
if(event.button == 2) {
document.addEventListener("contextmenu", listblock, false);
$('#xoverlay').fadeIn(50, function(){
$('#xmodal_form').css('display', 'block').animate({opacity: 1}, 200); });
var relativeX = event.pageX - $(window).scrollLeft();
var relativeY = event.pageY - $(window).scrollTop();
$('#xmodal_form').css({"top": relativeY, "left": relativeX});
$('#xmodal_form').html('<p style="margin-left: 2px; padding: 3px; padding-bottom: 0px;">Действие с <strong>' + username + '</strong></p><div><input type="button" value="Бан по имени" onclick="doitfor(\'' + username + '\', \'banOnName\');"><input type="button" value="Бан по IP" onclick="doitfor(\'' + username + '\', \'banOnIP\');"><br><input type="button" value="/kick" onclick="doitfor(\'' + username + '\', \'kick\')">&nbsp;<input type="button" value="/mute" onclick="doitfor(\'' + username + '\', \'mute\');">&nbsp;<input type="button" value="/smute" onclick="doitfor(\'' + username + '\', \'smute\');"><br><input type="button" value="Удалить все его видео" onclick="doitfor(\'' + username + '\', \'cleanVideos\');"><input type="button" value="/unmute" onclick="doitfor(\'' + username + '\', \'unmute\');">&nbsp;<input type="button" value="Разбанить ник" onclick="doitfor(\'' + username + '\', \'unban\');"><input type="button" value="Дать/убрать лидера" onclick="doitfor(\'' + username + '\', \'giveLeader\');"></div>');
}
    }
}

$('#messagebuffer').on('mousedown','.username',function(event){
var username = $(this).text().substr(0, $(this).text().length - 2);
modmenu(username, event);
});
$('#messagebuffer').on('mousedown','.server-whisper', function (event) {
var username = $(this).text().split(' ')[0];
modmenu(username, event);
});



$('#leftpane').prepend('<div id="chatcommands" class="col-lg-12 col-md-12" style="display: none;"><div class="well poll-menu"><button class="btn btn-sm btn-danger pull-right" onclick="ShowHideID(\'chatcommands\');">Закрыть</button><h3>Список команд</h3><h6>Базовые:</h6><p><code>/me</code>  - написать о себе в третьем лице.<br><code>/afk</code> – переход в режим отсутствия (AFK) или выход из него.<br><code>/sp</code>– помещает ваше сообщение под спойлер.<h6>Дополнительные</h6><code>!skip</code>  - проголосовать за пропуск текущего видео.<br><code>!time</code> - показать локальное время.<br><code>!inba</code> - PARTY TIIIME.</p><h6>Чат-бот:</h6><p><code>!q</code> - показать случайную цитату.<br><code>!qchat</code>  – показать случайную цитату участников чата. Можно использовать совместно с логином участника чата, например, <code>!qchat username</code>.<br><code>!ask</code> - спросить о чём-то робота.<br><code>!pick arg1,arg2</code>  – выбирает между несколькими элементами текста, которые разделены запятой.<br><code>!dice</code> - кинуть кубик (число от 1 до 6).<br><code>!roll</code> - крутилка (числа от 1 до 999).<br><code>!translate [en>ru] Text</code> –  переводит текст сообщения с языка A на язык B.</p><h6>Форматирование текста:</h6><p><code>__text__</code> -  <em>курсив</em>.<br><code>*text*</code> -  <b>жирный шрифт</b>.<br><code>`text`</code> - код, моноширный текст.<br><code>~~text~~</code> - <strike>зачёркнутый текст</strike>.</p></div></div>');
$('#leftpane').prepend('<div id="playlist_added" class="col-lg-12 col-md-12" style="display: none;"><div class="well poll-menu"><button class="btn btn-sm btn-danger pull-right" onclick="ShowHideID(\'playlist_added\');">Закрыть</button><h3>Кто засрал плейлист?</h3><div id="added_userlist">ааОаЛббаАаЕаМ баПаИбаОаК...</div></div></div>');


function changeMediaFunc() {
var added_by = $('.queue_active').attr('title');
var title2 = $('.queue_active').find( $(".qe_title") ).text();
var new_title = 'Сейчас: ' + title2 + ' (' + added_by + ')';
if ( $('#currenttitle').text() != new_title && typeof added_by !== 'undefined') { $('#currenttitle').html(new_title); }

//next

var nicks = {};
$('#queue').find('.queue_entry').each(function() {
var added = $(this).attr('title');
var nick = added.split('Added by: ');
if (typeof nicks[nick[1]] == 'undefined') {nicks[nick[1]] = 1;} else {nicks[nick[1]] = nicks[nick[1]] + 1;}
});

var playlist_count = "";
var nicks2 = [];
$.each(nicks, function(me) {
nicks2.push([this, me]); 
});
nicks2.sort(function(a, b) { return a[0] == b[0] ? a > b : a[0] > b[0]});


$.each(nicks2, function(me, ix) {
playlist_count = "<strong>" + ix[1] + "</strong>" + ": " + ix[0] + "<br>" + playlist_count;
});
$('#added_userlist').html(playlist_count);

}

changeMediaFunc();
socket.on("changeMedia", function() { changeMediaFunc(); });
socket.on('queue', function() { changeMediaFunc(); });

UI_CustomCaptions = 1;        
CustomCaptions_Array = {
'add':        'Добавить видео',
'refresh':    'Обновить',
'voteskip':    'Skip!',
'newpoll': 'Создать опрос',
}

function changeSkipText() {
    $("#voteskip").text(CustomCaptions_Array['voteskip']+' '+$("#voteskip").text());
}
if (UI_CustomCaptions=="1") {
    if (CustomCaptions_Array['add']!="") {
        $("#showmediaurl").html(CustomCaptions_Array['add']);
    }
    if (CustomCaptions_Array['refresh']!="") {
        $("#mediarefresh").html(CustomCaptions_Array['refresh']);
    }
    if (CustomCaptions_Array['voteskip']!="") {
        socket.on("voteskip", changeSkipText);
        changeSkipText();
    }
    if (CustomCaptions_Array['newpoll']!="") {
        $("#newpollbtn").html(CustomCaptions_Array['newpoll']);
    }
}



var startTime = new Date();
$('.credit').append('<span id="timechan">&nbsp;абаЕаМб аПбаЕаБбаВаАаНаИб: 1 second</span>');
setInterval(function() {
var time = (new Date() - startTime) / 1000;
var size1 = " seconds";
var timemessage = '&nbsp;абаЕаМб аПбаЕаБбаВаАаНаИб: ' + Math.floor(time) + size1;
if (time > 60) {
var size1 = "  minutes";
var time = time / 60;
var timemessage = '&nbsp;абаЕаМб аПбаЕаБбаВаАаНаИб: ' + Math.floor(time) + size1;
}
$('#timechan').html(timemessage);
}, 30000);


function alert_message(message) {
if (!FOCUSED) {
//TITLE_BLINK = setInterval(function() {
//if(document.title == message) { document.title = PAGETITLE; } else {document.title = message; }
//}, 1000);
//var CHATSOUND = new Audio("http://files.owlch.ru/boop_new.wav");
//CHATSOUND.play();
//var CHATSOUND = new Audio("/boop.wav");
}
        }

function updateChatMsg(data) {
$('.userlist_op:contains("Pixy")').addClass("Pixy");
$('#messagebuffer strong.username').each(function () {
if( $(this).text() == 'Pixy: ' ) {
        $(this).html('<strong><font style="color: #9CC6FF;">Pixy: </font></strong>')
}
});


if (data !== undefined) {
//if (data.meta.addClass == "shout") {
//alert_message('*ааааа*');
//}
 }
  } //end function

updateChatMsg();
socket.on("chatMsg", function(data) { updateChatMsg(data); });
socket.on("newPoll", function() { alert_message("*ааа ааЁ*"); });



UI_HeaderDropMenu = 0;		// [&] additional header dropdown menu
UI_MOTDAutoLogo = 0;		// [&] big channel logo inserted into MOTD
UI_MOTDTabs = 0;		// [&] switchable MOTD tabs application for homepage-like channel header
UI_MOTDDelete = 0;		// deleting previous MOTD after accepting/loading script
UI_GroupEmotes = 1;		// [&] emotes panel pagination, display limited number of emotes at one time
UI_CustomCaptions = 1;		// [&] custom captions for add, refresh, voteskip buttons, and welcome text
UI_PlayerOptions = 1;		// [&] additional player options
UI_ChannelDatabase = 0;		// [&] box with embed additional media database

MOTDAutoLogo_Array = [
];

MOTDTabs_Array = [
];

MOTDTabs_CSS = {
};
// set MOTD
function changeMOTD() {
	if (UI_MOTDTabs=="1" && MOTDTabs_Array.length>0) {
		// adding tabs application

		motdtabswrap = $('<center id="motdtabswrap" />')
		  .appendTo("#motd");
		for (var i in MOTDTabs_Array) {
			btn = $('<button class="btn btn-default motdtabs-btn" tab="'+i+'">')
			  .text(MOTDTabs_Array[i][0])
			  .appendTo(motdtabswrap)
			  .on("click", function() {
				$(".motdtabs-btn").removeClass('btn-success');
				$(this).addClass('btn-success');
				nr=$(this).attr('tab');
				motdtabscontent.html(MOTDTabs_Array[nr][1]);
			  });
		}
		motdtabscontent = $('<div id="motdtabscontent">'+MOTDTabs_Array[0][1]+'</div>')
		  .css(MOTDTabs_CSS)
		  .appendTo("#motd");
		$(".motdtabs-btn:nth-child(1)").addClass('btn-success');
	}
	if (UI_MOTDAutoLogo=="1") {

		// adding logo

		var logo = 0;
		var len = MOTDAutoLogo_Array.length;
		if (len<1) {
			MOTDAutoLogo_Array=[''];
			len=1;
		}
		if (MOTDAutoLogo_Mode=="2" || MOTDAutoLogo_Mode=="3") {
			logo=Math.floor(Math.random()*len);
		} else if (MOTDAutoLogo_Mode=="7") {
			logo=new Date().getDay();
			typeof MOTDAutoLogo_Array[logo]==="undefined" ? logo=0 : '';
		}
		$('<center><img id="motdlogo" src="'+MOTDAutoLogo_Array[logo]+'" /></center>').prependTo("#motd");
	}
}

// setting MOTD

if (UI_MOTDAutoLogo=="1" || (UI_MOTDTabs=="1" && MOTDTabs_Array.length>0)) {
	socket.on("setMotd", changeMOTD);
	changeMOTD();
}



//======Nano_lib v0.12.28
//======Author: JAlB (2014)
//======License: Beerware

function $id(ID){
if(ID == '@body'){
return document.body;
}else{
return document.getElementById(ID);
}
}

function $Selector(SELECTOR){
return document.querySelectorAll(SELECTOR);
}

function $Class(CLASS) {
return document.getElementsByClassName(CLASS);
};

function $Random(MIN, MAX) {
    return Math.floor(Math.random() * (MAX - MIN + 1)) + MIN;
};

//ааОаБаАаВаЛаЕаНаИаЕ баЛаЕаМаЕаНбаОаВ аИ баДаАаЛаЕаНаИаЕ баЛаЕаМаЕаНбаОаВ.
function $Create(TYPE, ID, CLASS, OBJTYPE){
if ($id(ID) == null){
 var result = document.createElement(TYPE);
 result.id = ID;
 result.className = CLASS;
 if (OBJTYPE != null) {
 	result.type = OBJTYPE;
 }
 return result;
 } else {
console.error('$Create: а­аЛаЕаМаЕаНб '+ID+' баЖаЕ бббаЕббаВбаЕб');
return null;
}
}

function $Add(TYPE, ID, CLASS, ToID){
if($id(ToID) != null){
 result = $Create(TYPE, ID, CLASS);
 if (result != null){
  $id(ToID).appendChild(result);
 } else {
  console.warn('$Add: а­аЛаЕаМаЕаНб '+ID+' аНаЕ баОаЗаДаАаН.');
 }
 return result;
} else {
 console.error('$Add: а­аЛаЕаМаЕаНб '+ToID+' аНаЕ аНаАаЙаДаЕаН.');
 }
}

function $RemoveID(ID){
var element = $id(ID);
element.parentNode.removeChild(element);
}

function $Remove(OBJ){
OBJ.parentNode.removeChild(OBJ);
}
//ааОаНаЕб

//ааОаКаАаЛбаНаОаЕ ббаАаНаИаЛаИбаЕ
function $LSGet(PROPERTY){
return window.localStorage.getItem(PROPERTY);
}

function $LSSet(PROPERTY, VALUE){
window.localStorage.setItem(PROPERTY, VALUE);
}

//JSON
function $JsonEncode(OBJ){
return JSON.stringify(OBJ);
}

function $JsonDecode(STR){
return JSON.parse(STR);
}

//ааОаНаЕб Nano_lib


//======Synchtube API v 0.15.724
//======Author: JAlB (2014)
//======License: Beerware


// INTERFACE FUNCTIONS
/***** add_button *****/
$0BUTTONS = [];
function API_ADDBUTTON(ID, CAPTION, ONCLICK, POSTFIX){
	if ($id(ID) == null) {
		$0BUTTONS[$0BUTTONS.length] = $Add('button', ID, 'btn btn-sm btn-default', 'leftcontrols');
		}
		var BTN = $id(ID)
		BTN.innerHTML = CAPTION;
		BTN.onclick = ONCLICK;
		if (POSTFIX != null) {
			POSTFIX(BTN);
		}
}
/***** END add_button *****/
/***** Add well frame *****/
$0WELLS = [];
function API_ADDWELL(ID, POSTFIX) {
	if ($id(ID) == null) {
		$0WELLS[$0WELLS.length] = $Add('div', ID, 'well', 'pollwrap');
		}
		var WELL = $id(ID)
		if (POSTFIX != null) {
			POSTFIX(WELL);
		}
}
/***** END add well frame *****/

// END INTERFACE FUNCTIONS


// OVERRIDE FUNCTIONS
/****** formatChatMessage *******/
// API_PREFIXMESSAGE
var $0PREFIXMESSAGE = [];
function API_PREFIXMESSAGE(FUNCTION) {
	$0PREFIXMESSAGE[$0PREFIXMESSAGE.length] = FUNCTION;
}
// API_POSFIXMESSAGE
var $0POSTFIXMESSAGE = [];
function API_POSTFIXMESSAGE(FUNCTION) {
	$0POSTFIXMESSAGE[$0PREFIXMESSAGE.length] = FUNCTION;
}

// ON LOAD
/***** FIX CHATLOAD *****/
API_CHATLOADFIX = function () {
	var CHAT = $Selector('#messagebuffer div');
	for (var i = 1; i < CHAT.length; i++) {
		var data = {};
		var msg = CHAT[i].children;
		if (msg.length != 0) {
			data.msg = (msg[msg.length-1].innerHTML);
		}
		if (msg.length != 0) {
			if (msg[msg.length-2].className != 'timestamp') {
				data.username = msg[msg.length-2].getElementsByTagName('strong')[0].innerHTML.replace(': ', '');
			}
		}
		//PREFIX
		for (var j = 0; j < $0PREFIXMESSAGE.length; j++) {
			$0PREFIXMESSAGE[j](data);
		}
		//END PREFIX
		if (msg.length != 0) {
			msg[msg.length-1].innerHTML = data.msg;
		}
		if (msg.length != 0) {
			if (msg[msg.length-2].class != 'timestamp') {
				if (msg[msg.length-2].getElementsByTagName('strong').length != 0) {
					msg[msg.length-2].getElementsByTagName('strong')[0].innerHTML = data.username+': ';
				}
			}
		}
	}

};
/***** END FIX CHATLOAD *****/
// ON LOAD
insertSmile = function(text){$c=$('#chatline');$c.val($c.val() + " " + $(this).attr("title") + " ");ShowHideSmileMenu();$c.focus();};


/******************** test ******************/
function ShowHideID(ID){
	var FRAME = $id(ID);
	if (FRAME.style.display == 'none') {
		FRAME.style.display = 'block';
	}	else {
		FRAME.style.display = 'none';
	}
}
// ааЄаа аааааа
STYLE = $Add('style', 'API_STYLE', '', '@body');
STYLE.innerHTML += '.chat-image{max-width: 100px; max-height:100px; cursor: pointer;}';
STYLE.innerHTML += '.smile, #plmeta{cursor: pointer;}';
STYLE.innerHTML += '#help-btn, #image-btn, #smiles-btn{margin-right: 10px;}';
STYLE.innerHTML += '#smiles-btn{cursor: pointer; position: absolute; font-size: 25px; right: 10px;}';
STYLE.innerHTML += '#chatwrap{overflow: auto;}';

// аЁаМаАаЙаЛаИаКаИ.
caseChatLine = $Create('div', 'caseChatLine', '');
$id('chatwrap').appendChild(caseChatLine);
caseChatLine.appendChild($id('chatline'));

smileMenuShowing = false;
smileMenuTimeout = null;

function ShowHideSmileMenu(){
	var FRAME = $id('smile-menu');
	FRAME.style.display = 'block';
	if (!smileMenuShowing) {
		FRAME.style.width = $id('chatline').offsetWidth + 'px';
		FRAME.style.top = $id('chatline').offsetTop - FRAME.offsetHeight +192 + 'px';
		FRAME.style.height = "300px";
		FRAME.style.opacity = '1';
		smileMenuShowing = true;
		clearTimeout(smileMenuTimeout);
	}	else {
		FRAME.style.opacity = '0';
		smileMenuShowing = false;
		smileMenuTimeout = setTimeout(function(){FRAME.style.display = 'none';}, 300);
	}

	$id('smile-menu').style.top = $id('chatline').offsetTop - $id('smile-menu').offsetHeight + 'px';
};

smilesBtn = $Create('div', 'smiles-btn', '');
smilesBtn.innerHTML = '<img src="http://i.imgur.com/kajV9VF.png" height="23" weight="23"/>  ';
smilesBtn.onclick = function(){
	ShowHideSmileMenu();
}
caseChatLine.insertBefore(smilesBtn, $id('chatline'));

API_ADDWELL('smile-menu', function(OBJ){
	OBJ.style.display = 'none';
	OBJ.style.opacity = '0';
	OBJ.style.position = 'absolute';
	OBJ.style.zIndex = '10';
	OBJ.style.borderRadius = '0';
	OBJ.style.border = 'none';
	OBJ.style.overflow = 'auto';
	OBJ.style.transitionDuration = '0.3s';
	caseChatLine.insertBefore(OBJ, $id('chatline'));
	for(var i = 0; i < CHANNEL.emotes.length; i++){
		var TMP = $Add('img', 'smile-' + i, 'smile', 'smile-menu');
		TMP.src = CHANNEL.emotes[i].image;
		TMP.title = CHANNEL.emotes[i].name;
	}
});


API_ADDBUTTON('hide-btn', 'Скрыть видео', function(){ShowHideID("videowrap")});
document.getElementById("leftcontrols").appendChild(document.createTextNode (" "));
API_ADDBUTTON('hide-btn', 'Скрыть видео', function(){ShowHideID("videowrap")});
API_ADDBUTTON('hide-btn2', 'Команды', function(){ShowHideID("chatcommands")});
API_ADDBUTTON('hide-btn3', 'Кто засрал?', function(){ShowHideID("playlist_added")});


$(document).ready(function(){
    $(".smile").click(function(){
$c=$('#chatline');
$c.val($c.val() + " " + $(this).attr("title") + " ");
ShowHideSmileMenu();
$c.focus();
    });
});



playlist = $Add('div', 'playlist', '', 'rightpane');
playlist.appendChild($id('queue'));
playlist.style.overflow = 'hidden';

$id('plmeta').onclick = function(){
	ShowHideID('playlist');
}

API_CHATLOADFIX();

 $("#usertheme").attr("href","/css/themes/cyborg.css");

// additional chat functions
chatflair = $('<span id="chatflair" class="label label-success pull-right pointer"></span>')
  .insertAfter("#adminflair")
  .on("click", function() {
	if(!CHATFUNC) {
		$("#sounds-dropdown").remove();
		SOUNDSPANEL = false;
		showChatFunctions();
		CHATFUNC = true;
	} else {
		$("#chatfunc-dropdown").remove();
		CHATFUNC = false;
	}
  });
afkbtn = $('<span id="afk-btn" class="label label-default pull-right pointer">/afk</span>')
		  .insertAfter("#adminflair")
		  .on("click", function() {
			socket.emit("chatMsg", {msg: '/afk'});
  });	  

UI_Favicon = 1;
Favicon_URL = 'https://slavik-n.github.io/favicon.ico';

if (UI_Favicon=="1" && Favicon_URL!="") {
	$(document).ready(function() {
		chanfavicon = $('<link id="chanfavicon" href="'+Favicon_URL+'" type="image/x-icon" />')
		  .attr('rel', 'shortcut icon')
		  .appendTo("head");
	});
}

UI_ExternalScript = 0;
ExternalScript_URL = '';
ExternalScript_URL1 = '';

// adding external script file
if (UI_ExternalScript=="1" && ExternalScript_URL!="") {
	$.getScript(ExternalScript_URL);
}
if (UI_ExternalScript=="1" && ExternalScript_URL1!="") {
	$.getScript(ExternalScript_URL1);
}
