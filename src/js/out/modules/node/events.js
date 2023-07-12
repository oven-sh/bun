function throwNotImplemented(feature, issue) {
  throw hideFromStack(throwNotImplemented), new NotImplementedError(feature, issue);
}
function hideFromStack(...fns) {
  for (let fn of fns)
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
}

class NotImplementedError extends Error {
  code;
  constructor(feature, issue) {
    super(feature + " is not yet implemented in Bun." + (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : ""));
    this.name = "NotImplementedError", this.code = "ERR_NOT_IMPLEMENTED", hideFromStack(NotImplementedError);
  }
}

// src/js/node/events.js
var EventEmitter = function(opts) {
  if (this._events === void 0 || this._events === this.__proto__._events)
    this._events = { __proto__: null }, this._eventsCount = 0;
  if (this._maxListeners ??= void 0, this[kCapture] = opts?.captureRejections ? Boolean(opts?.captureRejections) : EventEmitterPrototype[kCapture])
    this.emit = emitWithRejectionCapture;
}, emitError = function(emitter, args) {
  var { _events: events } = emitter;
  if (args[0] ??= new Error("Unhandled error."), !events)
    throw args[0];
  var errorMonitor = events[kErrorMonitor];
  if (errorMonitor)
    for (var handler of ArrayPrototypeSlice.call(errorMonitor))
      handler.apply(emitter, args);
  var handlers = events.error;
  if (!handlers)
    throw args[0];
  for (var handler of ArrayPrototypeSlice.call(handlers))
    handler.apply(emitter, args);
  return !0;
}, addCatch = function(emitter, promise, type, args) {
  promise.then(void 0, function(err) {
    process.nextTick(emitUnhandledRejectionOrErr, emitter, err, type, args);
  });
}, emitUnhandledRejectionOrErr = function(emitter, err, type, args) {
  if (typeof emitter[kRejection] === "function")
    emitter[kRejection](err, type, ...args);
  else
    try {
      emitter[kCapture] = !1, emitter.emit("error", err);
    } finally {
      emitter[kCapture] = !0;
    }
}, overflowWarning = function(emitter, type, handlers) {
  handlers.warned = !0;
  const warn = new Error(`Possible EventEmitter memory leak detected. ${handlers.length} ${String(type)} listeners ` + `added to [${emitter.constructor.name}]. Use emitter.setMaxListeners() to increase limit`);
  warn.name = "MaxListenersExceededWarning", warn.emitter = emitter, warn.type = type, warn.count = handlers.length, process.emitWarning(warn);
}, onceWrapper = function(type, listener, ...args) {
  this.removeListener(type, listener), listener.apply(this, args);
}, once = function(emitter, type, options) {
  var signal = options?.signal;
  if (validateAbortSignal(signal, "options.signal"), signal?.aborted)
    throw new AbortError(void 0, { cause: signal?.reason });
  return new Promise((resolve, reject) => {
    const errorListener = (err) => {
      if (emitter.removeListener(type, resolver), signal != null)
        eventTargetAgnosticRemoveListener(signal, "abort", abortListener);
      reject(err);
    }, resolver = (...args) => {
      if (typeof emitter.removeListener === "function")
        emitter.removeListener("error", errorListener);
      if (signal != null)
        eventTargetAgnosticRemoveListener(signal, "abort", abortListener);
      resolve(args);
    };
    if (eventTargetAgnosticAddListener(emitter, type, resolver, { once: !0 }), type !== "error" && typeof emitter.once === "function")
      emitter.once("error", errorListener);
    function abortListener() {
      eventTargetAgnosticRemoveListener(emitter, type, resolver), eventTargetAgnosticRemoveListener(emitter, "error", errorListener), reject(new AbortError(void 0, { cause: signal?.reason }));
    }
    if (signal != null)
      eventTargetAgnosticAddListener(signal, "abort", abortListener, { once: !0 });
  });
}, on = function(emitter, type, options) {
  var { signal, close, highWatermark = Number.MAX_SAFE_INTEGER, lowWatermark = 1 } = options || {};
  throwNotImplemented("events.on", 2679);
}, getEventListeners = function(emitter, type) {
  if (emitter instanceof EventTarget)
    throwNotImplemented("getEventListeners with an EventTarget", 2678);
  return emitter.listeners(type);
}, setMaxListeners = function(n, ...eventTargets) {
  validateNumber(n, "setMaxListeners", 0);
  var length;
  if (eventTargets && (length = eventTargets.length))
    for (let i = 0;i < length; i++)
      eventTargets[i].setMaxListeners(n);
  else
    defaultMaxListeners = n;
}, listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
}, eventTargetAgnosticRemoveListener = function(emitter, name, listener, flags) {
  if (typeof emitter.removeListener === "function")
    emitter.removeListener(name, listener);
  else
    emitter.removeEventListener(name, listener, flags);
}, eventTargetAgnosticAddListener = function(emitter, name, listener, flags) {
  if (typeof emitter.on === "function")
    emitter.on(name, listener);
  else
    emitter.addEventListener(name, listener);
}, ERR_INVALID_ARG_TYPE = function(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  return err.code = "ERR_INVALID_ARG_TYPE", err;
}, ERR_OUT_OF_RANGE = function(name, range, value) {
  const err = new RangeError(`The "${name}" argument is out of range. It must be ${range}. Received ${value}`);
  return err.code = "ERR_OUT_OF_RANGE", err;
}, validateAbortSignal = function(signal, name) {
  if (signal !== void 0 && (signal === null || typeof signal !== "object" || !("aborted" in signal)))
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
}, validateNumber = function(value, name, min = void 0, max) {
  if (typeof value !== "number")
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  if (min != null && value < min || max != null && value > max || (min != null || max != null) && Number.isNaN(value))
    throw new ERR_OUT_OF_RANGE(name, `${min != null ? `>= ${min}` : ""}${min != null && max != null ? " && " : ""}${max != null ? `<= ${max}` : ""}`, value);
}, checkListener = function(listener) {
  if (typeof listener !== "function")
    throw new TypeError("The listener must be a function");
}, { isPromise, Array, Object: Object2 } = globalThis[Symbol.for("Bun.lazy")]("primordials"), SymbolFor = Symbol.for, ObjectDefineProperty = Object2.defineProperty, kCapture = Symbol("kCapture"), kErrorMonitor = SymbolFor("events.errorMonitor"), kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners"), kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned"), kWatermarkData = SymbolFor("nodejs.watermarkData"), kRejection = SymbolFor("nodejs.rejection"), captureRejectionSymbol = SymbolFor("nodejs.rejection"), ArrayPrototypeSlice = Array.prototype.slice, defaultMaxListeners = 10, EventEmitterPrototype = EventEmitter.prototype;
EventEmitterPrototype._events = void 0;
EventEmitterPrototype._eventsCount = 0;
EventEmitterPrototype._maxListeners = void 0;
EventEmitterPrototype.setMaxListeners = function setMaxListeners2(n) {
  return validateNumber(n, "setMaxListeners", 0), this._maxListeners = n, this;
};
EventEmitterPrototype.getMaxListeners = function getMaxListeners() {
  return this._maxListeners ?? defaultMaxListeners;
};
var emitWithoutRejectionCapture = function emit(type, ...args) {
  if (type === "error")
    return emitError(this, args);
  var { _events: events } = this;
  if (events === void 0)
    return !1;
  var handlers = events[type];
  if (handlers === void 0)
    return !1;
  for (var handler of [...handlers])
    handler.apply(this, args);
  return !0;
}, emitWithRejectionCapture = function emit2(type, ...args) {
  if (type === "error")
    return emitError(this, args);
  var { _events: events } = this;
  if (events === void 0)
    return !1;
  var handlers = events[type];
  if (handlers === void 0)
    return !1;
  for (var handler of [...handlers]) {
    var result = handler.apply(this, args);
    if (result !== void 0 && isPromise(result))
      addCatch(this, result, type, args);
  }
  return !0;
};
EventEmitterPrototype.emit = emitWithoutRejectionCapture;
EventEmitterPrototype.addListener = function addListener(type, fn) {
  checkListener(fn);
  var events = this._events;
  if (!events)
    events = this._events = { __proto__: null }, this._eventsCount = 0;
  else if (events.newListener)
    this.emit("newListener", type, fn.listener ?? fn);
  var handlers = events[type];
  if (!handlers)
    events[type] = [fn], this._eventsCount++;
  else {
    handlers.push(fn);
    var m = this._maxListeners ?? defaultMaxListeners;
    if (m > 0 && handlers.length > m && !handlers.warned)
      overflowWarning(this, type, handlers);
  }
  return this;
};
EventEmitterPrototype.on = EventEmitterPrototype.addListener;
EventEmitterPrototype.prependListener = function prependListener(type, fn) {
  checkListener(fn);
  var events = this._events;
  if (!events)
    events = this._events = { __proto__: null }, this._eventsCount = 0;
  else if (events.newListener)
    this.emit("newListener", type, fn.listener ?? fn);
  var handlers = events[type];
  if (!handlers)
    events[type] = [fn], this._eventsCount++;
  else {
    handlers.unshift(fn);
    var m = this._maxListeners ?? defaultMaxListeners;
    if (m > 0 && handlers.length > m && !handlers.warned)
      overflowWarning(this, type, handlers);
  }
  return this;
};
EventEmitterPrototype.once = function once2(type, fn) {
  checkListener(fn);
  const bound = onceWrapper.bind(this, type, fn);
  return bound.listener = fn, this.addListener(type, bound), this;
};
EventEmitterPrototype.prependOnceListener = function prependOnceListener(type, fn) {
  checkListener(fn);
  const bound = onceWrapper.bind(this, type, fn);
  return bound.listener = fn, this.prependListener(type, bound), this;
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
  for (let i = length - 1;i >= 0; i--)
    if (handlers[i] === fn || handlers[i].listener === fn) {
      position = i;
      break;
    }
  if (position < 0)
    return this;
  if (position === 0)
    handlers.shift();
  else
    handlers.splice(position, 1);
  if (handlers.length === 0)
    delete events[type], this._eventsCount--;
  return this;
};
EventEmitterPrototype.off = EventEmitterPrototype.removeListener;
EventEmitterPrototype.removeAllListeners = function removeAllListeners(type) {
  var { _events: events } = this;
  if (type && events) {
    if (events[type])
      delete events[type], this._eventsCount--;
  } else
    this._events = { __proto__: null };
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
EventEmitterPrototype[kCapture] = !1;
EventEmitter.once = once;
EventEmitter.on = on;
EventEmitter.getEventListeners = getEventListeners;
EventEmitter.setMaxListeners = setMaxListeners;
EventEmitter.listenerCount = listenerCount;
EventEmitter.EventEmitter = EventEmitter;
EventEmitter.usingDomains = !1;
EventEmitter.captureRejectionSymbol = captureRejectionSymbol;
ObjectDefineProperty(EventEmitter, "captureRejections", {
  __proto__: null,
  get() {
    return EventEmitterPrototype[kCapture];
  },
  set(value) {
    validateBoolean(value, "EventEmitter.captureRejections"), EventEmitterPrototype[kCapture] = value;
  },
  enumerable: !0
});
EventEmitter.errorMonitor = kErrorMonitor;
Object2.defineProperties(EventEmitter, {
  defaultMaxListeners: {
    enumerable: !0,
    get: () => {
      return defaultMaxListeners;
    },
    set: (arg) => {
      validateNumber(arg, "defaultMaxListeners", 0), defaultMaxListeners = arg;
    }
  },
  kMaxEventTargetListeners: {
    __proto__: null,
    value: kMaxEventTargetListeners,
    enumerable: !1,
    configurable: !1,
    writable: !1
  },
  kMaxEventTargetListenersWarned: {
    __proto__: null,
    value: kMaxEventTargetListenersWarned,
    enumerable: !1,
    configurable: !1,
    writable: !1
  }
});
EventEmitter.init = EventEmitter;
EventEmitter[Symbol.for("CommonJS")] = 0;

class AbortError extends Error {
  constructor(message = "The operation was aborted", options = void 0) {
    if (options !== void 0 && typeof options !== "object")
      throw new codes.ERR_INVALID_ARG_TYPE("options", "Object", options);
    super(message, options);
    this.code = "ABORT_ERR", this.name = "AbortError";
  }
}

class EventEmitterAsyncResource extends EventEmitter {
  constructor(options = void 0) {
    throwNotImplemented("EventEmitterAsyncResource", 1832);
  }
}
var usingDomains = !1;
Object2.assign(EventEmitter, { once, on, getEventListeners, setMaxListeners, listenerCount, EventEmitterAsyncResource });
var events_default = EventEmitter;
export {
  usingDomains,
  setMaxListeners,
  once,
  on,
  listenerCount,
  getEventListeners,
  kErrorMonitor as errorMonitor,
  events_default as default,
  captureRejectionSymbol,
  EventEmitterAsyncResource,
  EventEmitter
};
