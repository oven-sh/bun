// Reimplementation of https://nodejs.org/api/events.html
// Port of https://github.com/nodejs/node/blob/main/lib/events.js

// TODO: license information, it's MIT?

const kCapture = Symbol("kCapture");
const kErrorMonitor = Symbol("events.errorMonitor");
const kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners");
const kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned");
const kWatermarkData = Symbol.for("nodejs.watermarkData");

var defaultMaxListeners = 10;

// EventEmitter must be a standard function because some old code will do weird tricks like `EventEmitter.apply(this)`.
function EventEmitter(opts) {
  // if (this._events === undefined || this._events === this.__proto__._events) {
  //   this._events = { __proto__: null };
  //   this._eventsCount = 0;
  // }
  this._bunEvents = new Map();

  this._maxListeners ??= undefined;
  this[kCapture] = opts?.captureRejections ? Boolean(opts?.captureRejections) : EventEmitter.prototype[kCapture];
}

// EventEmitter.prototype._events = undefined;
// EventEmitter.prototype._eventsCount = 0;
// EventEmitter.prototype._maxListeners = undefined;
EventEmitter.prototype.setMaxListeners = function setMaxListeners() {
  // validateMaxListeners(n, "setMaxListeners");
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return this._maxListeners ?? EventEmitter.defaultMaxListeners;
};

EventEmitter.prototype.emit = function emit(type, ...args) {
  var error = type === "error";
  if (error && this._events[kErrorMonitor]) {
    this.emit(kErrorMonitor, ...args);
  }
  var handlers = this._bunEvents.get(type);
  if (handlers) {
    for (let i = 0; i < handlers.length; i++) {
      handlers[i].apply(this, args);
    }
  } else if (error) {
    // TODO: not following spec entirely
    if (args[0] instanceof Error) {
      throw args[0];
    } else {
      throw new Error("Unhandled error.");
    }
  }
  return this;
};

EventEmitter.prototype.addListener = function addListener(type, fn) {
  if (!this._bunEvents) {
    this._bunEvents = new Map();
  } else if (this._bunEvents.has("newListener")) {
    this.emit("newListener", type, fn.listener ?? fn);
  }
  var handlers = this._bunEvents.get(type);
  if (!handlers) {
    this._bunEvents.set(type, [fn]);
  } else {
    handlers.push(fn);
    // TODO: overflow check
  }
  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener = function prependListener() {
  //
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
  var handlers = this._bunEvents?.get(type);
  if (!handlers) return this;
  var i = handlers.findIndex(x => x === listener || x.listener === listener);
  if (i !== -1) handlers.splice(i, 1);
  if (handlers.length === 0) this._bunEvents.delete(type);
  return this;
};

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
  if (type) {
    this._bunEvents?.delete(type);
  } else {
    this._bunEvents?.clear();
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

EventEmitter.prototype.listenerCount = function listenerCount() {
  //
};

EventEmitter.prototype.types = function types() {
  //
};

EventEmitter.prototype[kCapture] = false;

class EventEmitterAsyncResource extends EventEmitter {}

// Static methods
EventEmitter.once = function on(emitter, type, { signal } = {}) {
  // return async iterator
};

EventEmitter.on = function on(emitter, type, { signal } = {}) {
  // return async iterator
};

EventEmitter.getEventListeners = function listenerCount(emitter, type) {
  // get event listeners
};

EventEmitter.EventEmitter = EventEmitter;
EventEmitter.usingDomains = true;
EventEmitter.captureRejectionSymbol = Symbol.for("nodejs.rejection");
EventEmitter.captureRejections = false;
EventEmitter.EventEmitterAsyncResource = EventEmitterAsyncResource;
EventEmitter.errorMonitor = Symbol.for("events.errorMonitor");
Object.defineProperty(EventEmitter, "defaultMaxListeners", {
  enumerable: true,
  get: () => {
    return defaultMaxListeners;
  },
  set: arg => {
    // validateMaxListeners(arg, "defaultMaxListeners");
    defaultMaxListeners = arg;
  },
});
EventEmitter.setMaxListeners = function setMaxListeners(n, eventTargets) {
  // set max listeners
};
EventEmitter.init = function (opts) {
  // TODO: what does this do??
};
EventEmitter.listenerCount = function listenerCount(emitter, type) {
  // return liseners
};

// TODO: this may not work in bun, not sure if internal modules are transpiled differently
export default EventEmitter;
