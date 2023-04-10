// Reimplementation of https://nodejs.org/api/events.html
// Port of https://github.com/nodejs/node/blob/main/lib/events.js

const kCapture = Symbol("kCapture");
const kErrorMonitor = Symbol("events.errorMonitor");
const kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners");
const kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned");
const kWatermarkData = Symbol.for("nodejs.watermarkData");
export const captureRejectionSymbol = Symbol.for("nodejs.rejection");

export var usingDomains = true;
export var captureRejections = false;
export var errorMonitor = Symbol.for("events.errorMonitor");

export var defaultMaxListeners = 10;

// EventEmitter must be a standard function because some old code will do weird tricks like `EventEmitter.apply(this)`.
export function EventEmitter(opts) {
  if (this._events === undefined || this._events === this.__proto__._events) {
    this._events = { __proto__: null };
    this._eventsCount = 0;
  }

  this._maxListeners ??= undefined;
  this[kCapture] = opts?.captureRejections ? Boolean(opts?.captureRejections) : EventEmitter.prototype[kCapture];
}

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._eventsCount = 0;
EventEmitter.prototype._maxListeners = undefined;
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  validateNumber(n, "setMaxListeners", 0);
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return this._maxListeners ?? EventEmitter.defaultMaxListeners;
};

function emitError(a, b, c) {
  throw new Error("emitError not implemented");
}

function handleEmitError(a, b, c) {
  throw new Error("handleEmitError not implemented");
}

EventEmitter.prototype.emit = function emit(type, ...args) {
  var handlers, length;
  if (type === "error") {
    return emitError(this, type, args);
  }
  if (!this._events) return false;
  try {
    handlers = this._events[type];
    if (!handlers) return this;
    length = handlers.length;
    for (let i = 0; i < length; i++) {
      handlers[i].apply(this, args);
    }
  } catch (error) {
    handleEmitError(this, type, error);
  }
  return true;
};

EventEmitter.prototype.addListener = function addListener(type, fn) {
  var events = this._events;
  if (!events) {
    events = this._events = { __proto__: null };
  } else if (events.newListener) {
    this.emit("newListener", type, fn.listener ?? fn);
  }
  var handlers = events[type];
  if (!handlers) {
    events[type] = [fn];
  } else {
    handlers.push(fn);
    // TODO: overflow check
  }
  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener = function prependListener() {
  var events = this._events;
  if (!events) {
    events = this._events = { __proto__: null };
  } else if (events.newListener) {
    this.emit("newListener", type, fn.listener ?? fn);
  }
  var handlers = events[type];
  if (!handlers) {
    events[type] = [fn];
  } else {
    handlers.unshift(fn);
    // TODO: overflow check
  }
  return this;
};

function onceWrapper(type, listener, ...args) {
  this.removeListener(type, listener);
  listener.apply(this, args);
}

EventEmitter.prototype.once = function once(type, listener) {
  const bound = onceWrapper.bind(this, type, listener);
  bound.listener = listener;
  this.addListener(type, bound);
  return this;
};

EventEmitter.prototype.prependOnceListener = function prependOnceListener() {
  const bound = onceWrapper.bind(this, type, listener);
  bound.listener = listener;
  this.prependListener(type, bound);
  return this;
};

EventEmitter.prototype.removeListener = function removeListener(type, listener) {
  var { _events: events } = this;
  if (!events) return this;
  var handlers = events[type];
  if (!handlers) return this;
  var length = handlers.length;
  let position = -1;
  for (let i = length - 1; i >= 0; i--) {
    if (handlers[i] === listener || handlers[i].listener === listener) {
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
    events[type] = undefined;
  }
  return this;
};

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
  var { events } = this;
  if (type && events) {
    events[type] = undefined;
  } else {
    this._events = { __proto__: null };
  }
  return this;
};

EventEmitter.prototype.listeners = function listeners() {
  var handlers = this._bunEvents?.get(type);
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers.listener ?? handlers];
  return handlers.map(x => x.listener ?? x);
};

EventEmitter.prototype.rawListeners = function rawListeners() {
  var handlers = this._bunEvents?.get(type);
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers];
  return handlers.slice(0); // TODO: fastest array copy
};

EventEmitter.prototype.listenerCount = function listenerCount(type) {
  var { _events: events } = this;
  if (!events) return 0;
  return events[type]?.length ?? 0;
};

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

EventEmitter.prototype[kCapture] = false;

export function once(emitter, type, { signal } = {}) {
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

export function on(emitter, type, { signal, close, highWatermark = Number.MAX_SAFE_INTEGER, lowWatermark = 1 } = {}) {
  throw new Error("events.on is not implemented");
}

export function getEventListeners(emitter, type) {
  // TODO: EventTarget support
  return emitter.listeners(type);
}

export function setMaxListeners(n, ...eventTargets) {
  validateNumber(n, "setMaxListeners", 0);
  if (eventTargets) {
    var { length } = eventTargets;
    for (let i = 0; i < length; i++) {
      eventTargets[i].setMaxListeners(n);
    }
  } else {
    defaultMaxListeners = n;
  }
}

export function listenerCount(emitter, type) {
  return emitter.listenerCount(type);
}

EventEmitter.EventEmitter = EventEmitter;
// EventEmitter.usingDomains = usingDomains; // TODO: getter/setter?
EventEmitter.captureRejectionSymbol = captureRejectionSymbol;
// EventEmitter.captureRejections = captureRejections; // TODO: getter/setter?
EventEmitter.errorMonitor = errorMonitor;
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

export const init = EventEmitter;
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

export class EventEmitterAsyncResource extends EventEmitter {
  constructor(options = undefined) {
    throw new Error("EventEmitterAsyncResource is not implemented");
  }
}

EventEmitter.EventEmitterAsyncResource = EventEmitterAsyncResource;

export const IT_WORKED = true;
