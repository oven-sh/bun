(function (){"use strict";// build2/tmp/node/events.ts
var emitError = function(emitter, args) {
  var { _events: events } = emitter;
  args[0] ??= new Error("Unhandled error.");
  if (!events)
    throw args[0];
  var errorMonitor = events[kErrorMonitor];
  if (errorMonitor) {
    for (var handler of ArrayPrototypeSlice.@call(errorMonitor)) {
      handler.@apply(emitter, args);
    }
  }
  var handlers = events.error;
  if (!handlers)
    throw args[0];
  for (var handler of ArrayPrototypeSlice.@call(handlers)) {
    handler.@apply(emitter, args);
  }
  return true;
};
var addCatch = function(emitter, promise, type, args) {
  promise.then(@undefined, function(err) {
    process.nextTick(emitUnhandledRejectionOrErr, emitter, err, type, args);
  });
};
var emitUnhandledRejectionOrErr = function(emitter, err, type, args) {
  if (typeof emitter[kRejection] === "function") {
    emitter[kRejection](err, type, ...args);
  } else {
    try {
      emitter[kCapture] = false;
      emitter.emit("error", err);
    } finally {
      emitter[kCapture] = true;
    }
  }
};
var overflowWarning = function(emitter, type, handlers) {
  handlers.warned = true;
  const warn = new Error(`Possible EventEmitter memory leak detected. ${handlers.length} ${@String(type)} listeners ` + `added to [${emitter.constructor.name}]. Use emitter.setMaxListeners() to increase limit`);
  warn.name = "MaxListenersExceededWarning";
  warn.emitter = emitter;
  warn.type = type;
  warn.count = handlers.length;
  process.emitWarning(warn);
};
var onceWrapper = function(type, listener, ...args) {
  this.removeListener(type, listener);
  listener.@apply(this, args);
};
var once = function(emitter, type, options) {
  var signal = options?.signal;
  validateAbortSignal(signal, "options.signal");
  if (signal?.aborted) {
    throw new AbortError(@undefined, { cause: signal?.reason });
  }
  return new @Promise((resolve, reject) => {
    const errorListener = (err) => {
      emitter.removeListener(type, resolver);
      if (signal != null) {
        eventTargetAgnosticRemoveListener(signal, "abort", abortListener);
      }
      reject(err);
    };
    const resolver = (...args) => {
      if (typeof emitter.removeListener === "function") {
        emitter.removeListener("error", errorListener);
      }
      if (signal != null) {
        eventTargetAgnosticRemoveListener(signal, "abort", abortListener);
      }
      resolve(args);
    };
    eventTargetAgnosticAddListener(emitter, type, resolver, { once: true });
    if (type !== "error" && typeof emitter.once === "function") {
      emitter.once("error", errorListener);
    }
    function abortListener() {
      eventTargetAgnosticRemoveListener(emitter, type, resolver);
      eventTargetAgnosticRemoveListener(emitter, "error", errorListener);
      reject(new AbortError(@undefined, { cause: signal?.reason }));
    }
    if (signal != null) {
      eventTargetAgnosticAddListener(signal, "abort", abortListener, { once: true });
    }
  });
};
var on = function(emitter, type, options) {
  var { signal, close, highWatermark = Number.MAX_SAFE_INTEGER, lowWatermark = 1 } = options || {};
  throwNotImplemented("events.on", 2679);
};
var getEventListeners = function(emitter, type) {
  if (emitter instanceof EventTarget) {
    throwNotImplemented("getEventListeners with an EventTarget", 2678);
  }
  return emitter.listeners(type);
};
var setMaxListeners = function(n, ...eventTargets) {
  validateNumber(n, "setMaxListeners", 0);
  var length;
  if (eventTargets && (length = eventTargets.length)) {
    for (let i = 0;i < length; i++) {
      eventTargets[i].setMaxListeners(n);
    }
  } else {
    defaultMaxListeners = n;
  }
};
var listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
};
var eventTargetAgnosticRemoveListener = function(emitter, name, listener, flags) {
  if (typeof emitter.removeListener === "function") {
    emitter.removeListener(name, listener);
  } else {
    emitter.removeEventListener(name, listener, flags);
  }
};
var eventTargetAgnosticAddListener = function(emitter, name, listener, flags) {
  if (typeof emitter.on === "function") {
    if (flags.once)
      emitter.once(name, listener);
    else
      emitter.on(name, listener);
  } else {
    emitter.addEventListener(name, listener, flags);
  }
};
var ERR_INVALID_ARG_TYPE = function(name, type, value) {
  const err = @makeTypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
};
var ERR_OUT_OF_RANGE = function(name, range, value) {
  const err = new RangeError(`The "${name}" argument is out of range. It must be ${range}. Received ${value}`);
  err.code = "ERR_OUT_OF_RANGE";
  return err;
};
var validateAbortSignal = function(signal, name) {
  if (signal !== @undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
};
var validateNumber = function(value, name, min = @undefined, max) {
  if (typeof value !== "number")
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  if (min != null && value < min || max != null && value > max || (min != null || max != null) && Number.isNaN(value)) {
    throw new ERR_OUT_OF_RANGE(name, `${min != null ? `>= ${min}` : ""}${min != null && max != null ? " && " : ""}${max != null ? `<= ${max}` : ""}`, value);
  }
};
var checkListener = function(listener) {
  if (typeof listener !== "function") {
    @throwTypeError("The listener must be a function");
  }
};
var { throwNotImplemented } = @getInternalField(@internalModuleRegistry, 6) || @createInternalModuleById(6);
var SymbolFor = Symbol.for;
var kCapture = Symbol("kCapture");
var kErrorMonitor = SymbolFor("events.errorMonitor");
var kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners");
var kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned");
var kWatermarkData = SymbolFor("nodejs.watermarkData");
var kRejection = SymbolFor("nodejs.rejection");
var captureRejectionSymbol = SymbolFor("nodejs.rejection");
var ArrayPrototypeSlice = @Array.prototype.slice;
var defaultMaxListeners = 10;
var EventEmitter = function EventEmitter2(opts) {
  if (this._events === @undefined || this._events === this.__proto__._events) {
    this._events = { __proto__: null };
    this._eventsCount = 0;
  }
  this._maxListeners ??= @undefined;
  if (this[kCapture] = opts?.captureRejections ? Boolean(opts?.captureRejections) : EventEmitterPrototype[kCapture]) {
    this.emit = emitWithRejectionCapture;
  }
};
var EventEmitterPrototype = EventEmitter.prototype = {};
EventEmitterPrototype._events = @undefined;
EventEmitterPrototype._eventsCount = 0;
EventEmitterPrototype._maxListeners = @undefined;
EventEmitterPrototype.setMaxListeners = function setMaxListeners2(n) {
  validateNumber(n, "setMaxListeners", 0);
  this._maxListeners = n;
  return this;
};
EventEmitterPrototype.constructor = EventEmitter;
EventEmitterPrototype.getMaxListeners = function getMaxListeners() {
  return this._maxListeners ?? defaultMaxListeners;
};
var emitWithoutRejectionCapture = function emit(type, ...args) {
  if (type === "error") {
    return emitError(this, args);
  }
  var { _events: events } = this;
  if (events === @undefined)
    return false;
  var handlers = events[type];
  if (handlers === @undefined)
    return false;
  const maybeClonedHandlers = handlers.length > 1 ? handlers.slice() : handlers;
  for (let i = 0, { length } = maybeClonedHandlers;i < length; i++) {
    const handler = maybeClonedHandlers[i];
    switch (args.length) {
      case 0:
        handler.@call(this);
        break;
      case 1:
        handler.@call(this, args[0]);
        break;
      case 2:
        handler.@call(this, args[0], args[1]);
        break;
      case 3:
        handler.@call(this, args[0], args[1], args[2]);
        break;
      default:
        handler.@apply(this, args);
        break;
    }
  }
  return true;
};
var emitWithRejectionCapture = function emit2(type, ...args) {
  if (type === "error") {
    return emitError(this, args);
  }
  var { _events: events } = this;
  if (events === @undefined)
    return false;
  var handlers = events[type];
  if (handlers === @undefined)
    return false;
  const maybeClonedHandlers = handlers.length > 1 ? handlers.slice() : handlers;
  for (let i = 0, { length } = maybeClonedHandlers;i < length; i++) {
    const handler = maybeClonedHandlers[i];
    let result;
    switch (args.length) {
      case 0:
        result = handler.@call(this);
        break;
      case 1:
        result = handler.@call(this, args[0]);
        break;
      case 2:
        result = handler.@call(this, args[0], args[1]);
        break;
      case 3:
        result = handler.@call(this, args[0], args[1], args[2]);
        break;
      default:
        result = handler.@apply(this, args);
        break;
    }
    if (result !== @undefined && @isPromise(result)) {
      addCatch(this, result, type, args);
    }
  }
  return true;
};
EventEmitterPrototype.emit = emitWithoutRejectionCapture;
EventEmitterPrototype.addListener = function addListener(type, fn) {
  checkListener(fn);
  var events = this._events;
  if (!events) {
    events = this._events = { __proto__: null };
    this._eventsCount = 0;
  } else if (events.newListener) {
    this.emit("newListener", type, fn.listener ?? fn);
  }
  var handlers = events[type];
  if (!handlers) {
    events[type] = [fn];
    this._eventsCount++;
  } else {
    handlers.push(fn);
    var m = this._maxListeners ?? defaultMaxListeners;
    if (m > 0 && handlers.length > m && !handlers.warned) {
      overflowWarning(this, type, handlers);
    }
  }
  return this;
};
EventEmitterPrototype.on = EventEmitterPrototype.addListener;
EventEmitterPrototype.prependListener = function prependListener(type, fn) {
  checkListener(fn);
  var events = this._events;
  if (!events) {
    events = this._events = { __proto__: null };
    this._eventsCount = 0;
  } else if (events.newListener) {
    this.emit("newListener", type, fn.listener ?? fn);
  }
  var handlers = events[type];
  if (!handlers) {
    events[type] = [fn];
    this._eventsCount++;
  } else {
    handlers.unshift(fn);
    var m = this._maxListeners ?? defaultMaxListeners;
    if (m > 0 && handlers.length > m && !handlers.warned) {
      overflowWarning(this, type, handlers);
    }
  }
  return this;
};
EventEmitterPrototype.once = function once2(type, fn) {
  checkListener(fn);
  const bound = onceWrapper.bind(this, type, fn);
  bound.listener = fn;
  this.addListener(type, bound);
  return this;
};
EventEmitterPrototype.prependOnceListener = function prependOnceListener(type, fn) {
  checkListener(fn);
  const bound = onceWrapper.bind(this, type, fn);
  bound.listener = fn;
  this.prependListener(type, bound);
  return this;
};
EventEmitterPrototype.removeListener = function removeListener(type, fn) {
  checkListener(fn);
  var { _events: events } = this;
  if (!events)
    return this;
  var handlers = events[type];
  if (!handlers)
    return this;
  var length = handlers.length;
  let position = -1;
  for (let i = length - 1;i >= 0; i--) {
    if (handlers[i] === fn || handlers[i].listener === fn) {
      position = i;
      break;
    }
  }
  if (position < 0)
    return this;
  if (position === 0) {
    handlers.shift();
  } else {
    handlers.splice(position, 1);
  }
  if (handlers.length === 0) {
    delete events[type];
    this._eventsCount--;
  }
  return this;
};
EventEmitterPrototype.off = EventEmitterPrototype.removeListener;
EventEmitterPrototype.removeAllListeners = function removeAllListeners(type) {
  var { _events: events } = this;
  if (type && events) {
    if (events[type]) {
      delete events[type];
      this._eventsCount--;
    }
  } else {
    this._events = { __proto__: null };
  }
  return this;
};
EventEmitterPrototype.listeners = function listeners(type) {
  var { _events: events } = this;
  if (!events)
    return [];
  var handlers = events[type];
  if (!handlers)
    return [];
  return handlers.map((x) => x.listener ?? x);
};
EventEmitterPrototype.rawListeners = function rawListeners(type) {
  var { _events } = this;
  if (!_events)
    return [];
  var handlers = _events[type];
  if (!handlers)
    return [];
  return handlers.slice();
};
EventEmitterPrototype.listenerCount = function listenerCount2(type) {
  var { _events: events } = this;
  if (!events)
    return 0;
  return events[type]?.length ?? 0;
};
EventEmitterPrototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};
EventEmitterPrototype[kCapture] = false;

class AbortError extends Error {
  constructor(message = "The operation was aborted", options = @undefined) {
    if (options !== @undefined && typeof options !== "object") {
      throw new codes.ERR_INVALID_ARG_TYPE("options", "Object", options);
    }
    super(message, options);
    this.code = "ABORT_ERR";
    this.name = "AbortError";
  }
}
var AsyncResource = null;

class EventEmitterAsyncResource extends EventEmitter {
  triggerAsyncId;
  asyncResource;
  constructor(options) {
    if (!AsyncResource) {
      AsyncResource = (@getInternalField(@internalModuleRegistry, 10) || @createInternalModuleById(10)).AsyncResource;
    }
    var { captureRejections = false, triggerAsyncId, name = new.target.name, requireManualDestroy } = options || {};
    super({ captureRejections });
    this.triggerAsyncId = triggerAsyncId ?? 0;
    this.asyncResource = new AsyncResource(name, { triggerAsyncId, requireManualDestroy });
  }
  emit(...args) {
    this.asyncResource.runInAsyncScope(() => super.emit(...args));
  }
  emitDestroy() {
    this.asyncResource.emitDestroy();
  }
}
Object.defineProperties(EventEmitter, {
  captureRejections: {
    get() {
      return EventEmitterPrototype[kCapture];
    },
    set(value) {
      validateBoolean(value, "EventEmitter.captureRejections");
      EventEmitterPrototype[kCapture] = value;
    },
    enumerable: true
  },
  defaultMaxListeners: {
    enumerable: true,
    get: () => {
      return defaultMaxListeners;
    },
    set: (arg) => {
      validateNumber(arg, "defaultMaxListeners", 0);
      defaultMaxListeners = arg;
    }
  },
  kMaxEventTargetListeners: {
    value: kMaxEventTargetListeners,
    enumerable: false,
    configurable: false,
    writable: false
  },
  kMaxEventTargetListenersWarned: {
    value: kMaxEventTargetListenersWarned,
    enumerable: false,
    configurable: false,
    writable: false
  }
});
Object.assign(EventEmitter, {
  once,
  on,
  getEventListeners,
  setMaxListeners,
  EventEmitter,
  usingDomains: false,
  captureRejectionSymbol,
  EventEmitterAsyncResource,
  errorMonitor: kErrorMonitor,
  setMaxListeners,
  init: EventEmitter,
  listenerCount
});
return EventEmitter})
