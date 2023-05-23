// Reimplementation of https://nodejs.org/api/events.html
// Reference: https://github.com/nodejs/node/blob/main/lib/events.js
var { isPromise, Array, Object } = import.meta.primordials;
const SymbolFor = Symbol.for;
const ObjectDefineProperty = Object.defineProperty;
const kCapture = Symbol("kCapture");
const kErrorMonitor = SymbolFor("events.errorMonitor");
const kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners");
const kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned");
const kWatermarkData = SymbolFor("nodejs.watermarkData");
const kRejection = SymbolFor("nodejs.rejection");
const captureRejectionSymbol = SymbolFor("nodejs.rejection");
const ArrayPrototypeSlice = Array.prototype.slice;

var defaultMaxListeners = 10;

// EventEmitter must be a standard function because some old code will do weird tricks like `EventEmitter.apply(this)`.
function EventEmitter(opts) {
  if (this._events === undefined || this._events === this.__proto__._events) {
    this._events = { __proto__: null };
    this._eventsCount = 0;
  }

  this._maxListeners ??= undefined;
  if (
    (this[kCapture] = opts?.captureRejections ? Boolean(opts?.captureRejections) : EventEmitterPrototype[kCapture])
  ) {
    this.emit = emitWithRejectionCapture;
  }
}
const EventEmitterPrototype = EventEmitter.prototype;
EventEmitterPrototype._events = undefined;
EventEmitterPrototype._eventsCount = 0;
EventEmitterPrototype._maxListeners = undefined;
EventEmitterPrototype.setMaxListeners = function setMaxListeners(n) {
  validateNumber(n, "setMaxListeners", 0);
  this._maxListeners = n;
  return this;
};

EventEmitterPrototype.getMaxListeners = function getMaxListeners() {
  return this._maxListeners ?? defaultMaxListeners;
};

function emitError(emitter, args) {
  var { _events: events } = emitter;
  args[0] ??= new Error("Unhandled error.");
  if (!events) throw args[0];
  var errorMonitor = events[kErrorMonitor];
  if (errorMonitor) {
    for (var handler of ArrayPrototypeSlice.call(errorMonitor)) {
      handler.apply(emitter, args);
    }
  }
  var handlers = events.error;
  if (!handlers) throw args[0];
  for (var handler of ArrayPrototypeSlice.call(handlers)) {
    handler.apply(emitter, args);
  }
  return true;
}

function addCatch(emitter, promise, type, args) {
  promise.then(undefined, function (err) {
    // The callback is called with nextTick to avoid a follow-up rejection from this promise.
    process.nextTick(emitUnhandledRejectionOrErr, emitter, err, type, args);
  });
}

function emitUnhandledRejectionOrErr(emitter, err, type, args) {
  if (typeof emitter[kRejection] === "function") {
    emitter[kRejection](err, type, ...args);
  } else {
    // If the error handler throws, it is not catchable and it will end up in 'uncaughtException'.
    // We restore the previous value of kCapture in case the uncaughtException is present
    // and the exception is handled.
    try {
      emitter[kCapture] = false;
      emitter.emit("error", err);
    } finally {
      emitter[kCapture] = true;
    }
  }
}

const emitWithoutRejectionCapture = function emit(type, ...args) {
  if (type === "error") {
    return emitError(this, args);
  }
  var { _events: events } = this;
  if (events === undefined) return false;
  var handlers = events[type];
  if (handlers === undefined) return false;

  for (var handler of [...handlers]) {
    handler.apply(this, args);
  }
  return true;
};

const emitWithRejectionCapture = function emit(type, ...args) {
  if (type === "error") {
    return emitError(this, args);
  }
  var { _events: events } = this;
  if (events === undefined) return false;
  var handlers = events[type];
  if (handlers === undefined) return false;
  for (var handler of [...handlers]) {
    var result = handler.apply(this, args);
    if (result !== undefined && isPromise(result)) {
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

function overflowWarning(emitter, type, handlers) {
  handlers.warned = true;
  const warn = new Error(
    `Possible EventEmitter memory leak detected. ${handlers.length} ${String(type)} listeners ` +
      `added to [${emitter.constructor.name}]. Use emitter.setMaxListeners() to increase limit`,
  );
  warn.name = "MaxListenersExceededWarning";
  warn.emitter = emitter;
  warn.type = type;
  warn.count = handlers.length;
  process.emitWarning(warn);
}

function onceWrapper(type, listener, ...args) {
  this.removeListener(type, listener);
  listener.apply(this, args);
}

EventEmitterPrototype.once = function once(type, fn) {
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
  if (!events) return this;
  var handlers = events[type];
  if (!handlers) return this;
  var length = handlers.length;
  let position = -1;
  for (let i = length - 1; i >= 0; i--) {
    if (handlers[i] === fn || handlers[i].listener === fn) {
      position = i;
      break;
    }
  }
  if (position < 0) return this;
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
  if (!events) return [];
  var handlers = events[type];
  if (!handlers) return [];
  return handlers.map(x => x.listener ?? x);
};

EventEmitterPrototype.rawListeners = function rawListeners(type) {
  var { _events } = this;
  if (!_events) return [];
  var handlers = _events[type];
  if (!handlers) return [];
  return handlers.slice();
};

EventEmitterPrototype.listenerCount = function listenerCount(type) {
  var { _events: events } = this;
  if (!events) return 0;
  return events[type]?.length ?? 0;
};

EventEmitterPrototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

EventEmitterPrototype[kCapture] = false;

function once(emitter, type, options) {
  var signal = options?.signal;
  validateAbortSignal(signal, "options.signal");
  if (signal?.aborted) {
    throw new AbortError(undefined, { cause: signal?.reason });
  }
  return new Promise((resolve, reject) => {
    const errorListener = err => {
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
      // EventTarget does not have `error` event semantics like Node
      // EventEmitters, we listen to `error` events only on EventEmitters.
      emitter.once("error", errorListener);
    }
    function abortListener() {
      eventTargetAgnosticRemoveListener(emitter, type, resolver);
      eventTargetAgnosticRemoveListener(emitter, "error", errorListener);
      reject(new AbortError(undefined, { cause: signal?.reason }));
    }
    if (signal != null) {
      eventTargetAgnosticAddListener(signal, "abort", abortListener, { once: true });
    }
  });
}
EventEmitter.once = once;

function on(emitter, type, options) {
  var { signal, close, highWatermark = Number.MAX_SAFE_INTEGER, lowWatermark = 1 } = options || {};
  throw new Error("events.on is not implemented. See https://github.com/oven-sh/bun/issues/2679");
}
EventEmitter.on = on;

function getEventListeners(emitter, type) {
  if (emitter instanceof EventTarget) {
    throw new Error(
      "getEventListeners with an EventTarget is not implemented. See https://github.com/oven-sh/bun/issues/2678",
    );
  }
  return emitter.listeners(type);
}
EventEmitter.getEventListeners = getEventListeners;

function setMaxListeners(n, ...eventTargets) {
  validateNumber(n, "setMaxListeners", 0);
  var length;
  if (eventTargets && (length = eventTargets.length)) {
    for (let i = 0; i < length; i++) {
      eventTargets[i].setMaxListeners(n);
    }
  } else {
    defaultMaxListeners = n;
  }
}
EventEmitter.setMaxListeners = setMaxListeners;

function listenerCount(emitter, type) {
  return emitter.listenerCount(type);
}
EventEmitter.listenerCount = listenerCount;

EventEmitter.EventEmitter = EventEmitter;
EventEmitter.usingDomains = false;
EventEmitter.captureRejectionSymbol = captureRejectionSymbol;
ObjectDefineProperty(EventEmitter, "captureRejections", {
  __proto__: null,
  get() {
    return EventEmitterPrototype[kCapture];
  },
  set(value) {
    validateBoolean(value, "EventEmitter.captureRejections");

    EventEmitterPrototype[kCapture] = value;
  },
  enumerable: true,
});
EventEmitter.errorMonitor = kErrorMonitor;
Object.defineProperties(EventEmitter, {
  defaultMaxListeners: {
    enumerable: true,
    get: () => {
      return defaultMaxListeners;
    },
    set: arg => {
      validateNumber(arg, "defaultMaxListeners", 0);
      defaultMaxListeners = arg;
    },
  },
  kMaxEventTargetListeners: {
    __proto__: null,
    value: kMaxEventTargetListeners,
    enumerable: false,
    configurable: false,
    writable: false,
  },
  kMaxEventTargetListenersWarned: {
    __proto__: null,
    value: kMaxEventTargetListenersWarned,
    enumerable: false,
    configurable: false,
    writable: false,
  },
});
EventEmitter.init = EventEmitter;
EventEmitter[Symbol.for("CommonJS")] = 0;

export default EventEmitter;

function eventTargetAgnosticRemoveListener(emitter, name, listener, flags) {
  if (typeof emitter.removeListener === "function") {
    emitter.removeListener(name, listener);
  } else {
    emitter.removeEventListener(name, listener, flags);
  }
}

function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
  if (typeof emitter.on === "function") {
    emitter.on(name, listener);
  } else {
    emitter.addEventListener(name, listener);
  }
}

class AbortError extends Error {
  constructor(message = "The operation was aborted", options = undefined) {
    if (options !== undefined && typeof options !== "object") {
      throw new codes.ERR_INVALID_ARG_TYPE("options", "Object", options);
    }
    super(message, options);
    this.code = "ABORT_ERR";
    this.name = "AbortError";
  }
}

function ERR_INVALID_ARG_TYPE(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
}

function ERR_OUT_OF_RANGE(name, range, value) {
  const err = new RangeError(`The "${name}" argument is out of range. It must be ${range}. Received ${value}`);
  err.code = "ERR_OUT_OF_RANGE";
  return err;
}

function validateAbortSignal(signal, name) {
  if (signal !== undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
}

function validateNumber(value, name, min = undefined, max) {
  if (typeof value !== "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  if (
    (min != null && value < min) ||
    (max != null && value > max) ||
    ((min != null || max != null) && Number.isNaN(value))
  ) {
    throw new ERR_OUT_OF_RANGE(
      name,
      `${min != null ? `>= ${min}` : ""}${min != null && max != null ? " && " : ""}${max != null ? `<= ${max}` : ""}`,
      value,
    );
  }
}

function checkListener(listener) {
  if (typeof listener !== "function") {
    throw new TypeError("The listener must be a function");
  }
}

export class EventEmitterAsyncResource extends EventEmitter {
  constructor(options = undefined) {
    throw new Error("EventEmitterAsyncResource is not implemented. See https://github.com/oven-sh/bun/issues/2681");
  }
}

EventEmitter.EventEmitterAsyncResource = EventEmitterAsyncResource;
