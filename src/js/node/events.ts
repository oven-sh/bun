// Reimplementation of https://nodejs.org/api/events.html

// Reference: https://github.com/nodejs/node/blob/main/lib/events.js

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

const { ERR_UNHANDLED_ERROR } = require("internal/errors");
const {
  validateObject,
  validateInteger,
  validateAbortSignal,
  validateNumber,
  validateBoolean,
  validateFunction,
} = require("internal/validators");

const { inspect, types } = require("node:util");

const SymbolFor = Symbol.for;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;
const ReflectOwnKeys = Reflect.ownKeys;

const kCapture = Symbol("kCapture");
const kErrorMonitor = SymbolFor("events.errorMonitor");
const kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners");
const kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned");
const kWatermarkData = SymbolFor("nodejs.watermarkData");
const kRejection = SymbolFor("nodejs.rejection");
const kFirstEventParam = SymbolFor("nodejs.kFirstEventParam");
const captureRejectionSymbol = SymbolFor("nodejs.rejection");

let FixedQueue;
const kEmptyObject = Object.freeze({ __proto__: null });

var defaultMaxListeners = 10;

// EventEmitter must be a standard function because some old code will do weird tricks like `EventEmitter.$apply(this)`.
function EventEmitter(opts) {
  if (this._events === undefined || this._events === this.__proto__._events) {
    this._events = { __proto__: null };
    this._eventsCount = 0;
  }

  this._maxListeners ??= undefined;
  if ((this[kCapture] = opts?.captureRejections ? Boolean(opts?.captureRejections) : EventEmitterPrototype[kCapture])) {
    this.emit = emitWithRejectionCapture;
  }
}
Object.defineProperty(EventEmitter, "name", { value: "EventEmitter", configurable: true });
const EventEmitterPrototype = (EventEmitter.prototype = {});

EventEmitterPrototype.setMaxListeners = function setMaxListeners(n) {
  validateNumber(n, "setMaxListeners", 0);
  this._maxListeners = n;
  return this;
};
Object.defineProperty(EventEmitterPrototype.setMaxListeners, "name", { value: "setMaxListeners" });

EventEmitterPrototype.constructor = EventEmitter;

EventEmitterPrototype.getMaxListeners = function getMaxListeners() {
  return _getMaxListeners(this);
};
Object.defineProperty(EventEmitterPrototype.getMaxListeners, "name", { value: "getMaxListeners" });

function emitError(emitter, args) {
  var { _events: events } = emitter;

  if (events !== undefined) {
    const errorMonitor = events[kErrorMonitor];
    if (errorMonitor) {
      for (const handler of ArrayPrototypeSlice.$call(errorMonitor)) {
        handler.$apply(emitter, args);
      }
    }

    const handlers = events.error;
    if (handlers) {
      for (var handler of ArrayPrototypeSlice.$call(handlers)) {
        handler.$apply(emitter, args);
      }
      return true;
    }
  }

  let er;
  if (args.length > 0) er = args[0];

  if (er instanceof Error) {
    throw er; // Unhandled 'error' event
  }

  let stringifiedEr;
  try {
    stringifiedEr = inspect(er);
  } catch {
    stringifiedEr = er;
  }

  // At least give some kind of context to the user
  const err = ERR_UNHANDLED_ERROR(stringifiedEr);
  err.context = er;
  throw err; // Unhandled 'error' event
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
  // Clone handlers array if necessary since handlers can be added/removed during the loop.
  // Cloning is skipped for performance reasons in the case of exactly one attached handler
  // since array length changes have no side-effects in a for-loop of length 1.
  const maybeClonedHandlers = handlers.length > 1 ? handlers.slice() : handlers;
  for (let i = 0, { length } = maybeClonedHandlers; i < length; i++) {
    const handler = maybeClonedHandlers[i];
    // For performance reasons Function.call(...) is used whenever possible.
    switch (args.length) {
      case 0:
        handler.$call(this);
        break;
      case 1:
        handler.$call(this, args[0]);
        break;
      case 2:
        handler.$call(this, args[0], args[1]);
        break;
      case 3:
        handler.$call(this, args[0], args[1], args[2]);
        break;
      default:
        handler.$apply(this, args);
        break;
    }
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
  // Clone handlers array if necessary since handlers can be added/removed during the loop.
  // Cloning is skipped for performance reasons in the case of exactly one attached handler
  // since array length changes have no side-effects in a for-loop of length 1.
  const maybeClonedHandlers = handlers.length > 1 ? handlers.slice() : handlers;
  for (let i = 0, { length } = maybeClonedHandlers; i < length; i++) {
    const handler = maybeClonedHandlers[i];
    let result;
    // For performance reasons Function.call(...) is used whenever possible.
    switch (args.length) {
      case 0:
        result = handler.$call(this);
        break;
      case 1:
        result = handler.$call(this, args[0]);
        break;
      case 2:
        result = handler.$call(this, args[0], args[1]);
        break;
      case 3:
        result = handler.$call(this, args[0], args[1], args[2]);
        break;
      default:
        result = handler.$apply(this, args);
        break;
    }
    if (result !== undefined && $isPromise(result)) {
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
    var m = _getMaxListeners(this);
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
    var m = _getMaxListeners(this);
    if (m > 0 && handlers.length > m && !handlers.warned) {
      overflowWarning(this, type, handlers);
    }
  }
  return this;
};

function overflowWarning(emitter, type, handlers) {
  handlers.warned = true;
  const warn = new Error(
    `Possible EventTarget memory leak detected. ${handlers.length} ${String(type)} listeners added to ${inspect(emitter, { depth: -1 })}. MaxListeners is ${emitter._maxListeners}. Use events.setMaxListeners() to increase limit`,
  );
  warn.name = "MaxListenersExceededWarning";
  warn.emitter = emitter;
  warn.type = type;
  warn.count = handlers.length;
  process.emitWarning(warn);
}

function _onceWrap(target, type, listener) {
  const state = { fired: false, wrapFn: undefined, target, type, listener };
  const wrapped = onceWrapper.bind(state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    if (arguments.length === 0) return this.listener.$call(this.target);
    return this.listener.$apply(this.target, arguments);
  }
}

EventEmitterPrototype.once = function once(type, fn) {
  checkListener(fn);
  this.on(type, _onceWrap(this, type, fn));
  return this;
};
Object.defineProperty(EventEmitterPrototype.once, "name", { value: "once" });

EventEmitterPrototype.prependOnceListener = function prependOnceListener(type, fn) {
  checkListener(fn);
  this.prependListener(type, _onceWrap(this, type, fn));
  return this;
};

EventEmitterPrototype.removeListener = function removeListener(type, listener) {
  checkListener(listener);

  const events = this._events;
  if (events === undefined) return this;

  const list = events[type];
  if (list === undefined) return this;

  let position = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] === listener || list[i].listener === listener) {
      position = i;
      break;
    }
  }
  if (position < 0) return this;

  if (position === 0) list.shift();
  else ArrayPrototypeSplice.$call(list, position, 1);

  if (list.length === 0) {
    delete events[type];
    this._eventsCount--;
  }

  if (events.removeListener !== undefined) this.emit("removeListener", type, listener.listener || listener);

  return this;
};

EventEmitterPrototype.off = EventEmitterPrototype.removeListener;

EventEmitterPrototype.removeAllListeners = function removeAllListeners(type) {
  const events = this._events;
  if (events === undefined) return this;

  if (events.removeListener === undefined) {
    if (type) {
      if (events[type]) {
        delete events[type];
        this._eventsCount--;
      }
    } else {
      this._events = { __proto__: null };
    }
    return this;
  }

  // Emit removeListener for all listeners on all events
  if (!type) {
    for (const key of ReflectOwnKeys(events)) {
      if (key === "removeListener") continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners("removeListener");
    this._events = { __proto__: null };
    this._eventsCount = 0;
    return this;
  }

  // emit in LIFO order
  const listeners = events[type];
  for (let i = listeners.length - 1; i >= 0; i--) this.removeListener(type, listeners[i]);
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

EventEmitterPrototype.listenerCount = function listenerCount(type, method) {
  var { _events: events } = this;
  if (!events) return 0;
  if (method != null) {
    var length = 0;
    for (const handler of events[type] ?? []) {
      if (handler === method || handler.listener === method) {
        length++;
      }
    }
    return length;
  }
  return events[type]?.length ?? 0;
};
Object.defineProperty(EventEmitterPrototype.listenerCount, "name", { value: "listenerCount" });

EventEmitterPrototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

EventEmitterPrototype[kCapture] = false;

function once(emitter, type, options = kEmptyObject) {
  validateObject(options, "options");
  var signal = options?.signal;
  validateAbortSignal(signal, "options.signal");
  if (signal?.aborted) {
    throw new AbortError(undefined, { cause: signal?.reason });
  }
  const { resolve, reject, promise } = $newPromiseCapability(Promise);
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

  return promise;
}
Object.defineProperty(once, "name", { value: "once" });

const AsyncIteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(async function* () {}).prototype);
function createIterResult(value, done) {
  return { value, done };
}
function on(emitter, event, options = kEmptyObject) {
  // Parameters validation
  validateObject(options, "options");
  const signal = options.signal;
  validateAbortSignal(signal, "options.signal");
  if (signal?.aborted) throw new AbortError(undefined, { cause: signal?.reason });
  // Support both highWaterMark and highWatermark for backward compatibility
  const highWatermark = options.highWaterMark ?? options.highWatermark ?? Number.MAX_SAFE_INTEGER;
  validateInteger(highWatermark, "options.highWaterMark", 1);
  // Support both lowWaterMark and lowWatermark for backward compatibility
  const lowWatermark = options.lowWaterMark ?? options.lowWatermark ?? 1;
  validateInteger(lowWatermark, "options.lowWaterMark", 1);

  // Preparing controlling queues and variables
  FixedQueue ??= require("internal/fixed_queue").FixedQueue;
  const unconsumedEvents = new FixedQueue();
  const unconsumedPromises = new FixedQueue();
  let paused = false;
  let error = null;
  let finished = false;
  let size = 0;

  const iterator = Object.setPrototypeOf(
    {
      next() {
        // First, we consume all unread events
        if (size) {
          const value = unconsumedEvents.shift();
          size--;
          if (paused && size < lowWatermark) {
            emitter.resume();
            paused = false;
          }
          return Promise.resolve(createIterResult(value, false));
        }

        // Then we error, if an error happened
        // This happens one time if at all, because after 'error'
        // we stop listening
        if (error) {
          const p = Promise.reject(error);
          // Only the first element errors
          error = null;
          return p;
        }

        // If the iterator is finished, resolve to done
        if (finished) return closeHandler();

        // Wait until an event happens
        return new Promise(function (resolve, reject) {
          unconsumedPromises.push({ resolve, reject });
        });
      },

      return() {
        return closeHandler();
      },

      throw(err) {
        if (!err || !(err instanceof Error)) {
          throw $ERR_INVALID_ARG_TYPE("EventEmitter.AsyncIterator", "Error", err);
        }
        errorHandler(err);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      [kWatermarkData]: {
        get size() {
          return size;
        },
        get low() {
          return lowWatermark;
        },
        get high() {
          return highWatermark;
        },
        get isPaused() {
          return paused;
        },
      },
    },
    AsyncIteratorPrototype,
  );

  // Adding event handlers
  const { addEventListener, removeAll } = listenersController();
  addEventListener(
    emitter,
    event,
    options[kFirstEventParam]
      ? eventHandler
      : function (...args) {
          return eventHandler(args);
        },
  );
  if (event !== "error" && typeof emitter.on === "function") {
    addEventListener(emitter, "error", errorHandler);
  }
  const closeEvents = options?.close;
  if (closeEvents?.length) {
    for (let i = 0; i < closeEvents.length; i++) {
      addEventListener(emitter, closeEvents[i], closeHandler);
    }
  }

  const abortListenerDisposable = signal ? addAbortListener(signal, abortListener) : null;

  return iterator;

  function abortListener() {
    errorHandler(new AbortError(undefined, { cause: signal?.reason }));
  }

  function eventHandler(value) {
    if (unconsumedPromises.isEmpty()) {
      size++;
      if (!paused && size > highWatermark) {
        paused = true;
        emitter.pause();
      }
      unconsumedEvents.push(value);
    } else unconsumedPromises.shift().resolve(createIterResult(value, false));
  }

  function errorHandler(err) {
    if (unconsumedPromises.isEmpty()) error = err;
    else unconsumedPromises.shift().reject(err);

    closeHandler();
  }

  function closeHandler() {
    abortListenerDisposable?.[Symbol.dispose]();
    removeAll();
    finished = true;
    const doneResult = createIterResult(undefined, true);
    while (!unconsumedPromises.isEmpty()) {
      unconsumedPromises.shift().resolve(doneResult);
    }

    return Promise.resolve(doneResult);
  }
}
Object.defineProperty(on, "name", { value: "on" });

function listenersController() {
  const listeners = [];

  return {
    addEventListener(emitter, event, handler, flags) {
      eventTargetAgnosticAddListener(emitter, event, handler, flags);
      listeners.push([emitter, event, handler, flags]);
    },
    removeAll() {
      while (listeners.length > 0) {
        const [emitter, event, handler, flags] = listeners.pop();
        eventTargetAgnosticRemoveListener(emitter, event, handler, flags);
      }
    },
  };
}

const getEventListenersForEventTarget = $newCppFunction(
  "JSEventTargetNode.cpp",
  "jsFunctionNodeEventsGetEventListeners",
  1,
);

function getEventListeners(emitter, type) {
  if ($isCallable(emitter?.listeners)) {
    return emitter.listeners(type);
  }

  return getEventListenersForEventTarget(emitter, type);
}

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/events.js#L315-L339
function setMaxListeners(n = defaultMaxListeners, ...eventTargets) {
  validateNumber(n, "setMaxListeners", 0);
  if (eventTargets.length === 0) {
    defaultMaxListeners = n;
  } else {
    for (let i = 0; i < eventTargets.length; i++) {
      const target = eventTargets[i];
      if (types.isEventTarget(target)) {
        target[kMaxEventTargetListeners] = n;
        target[kMaxEventTargetListenersWarned] = false;
      } else if (typeof target.setMaxListeners === "function") {
        target.setMaxListeners(n);
      } else {
        throw $ERR_INVALID_ARG_TYPE("eventTargets", ["EventEmitter", "EventTarget"], target);
      }
    }
  }
}
Object.defineProperty(setMaxListeners, "name", { value: "setMaxListeners" });

const jsEventTargetGetEventListenersCount = $newCppFunction(
  "JSEventTarget.cpp",
  "jsEventTargetGetEventListenersCount",
  2,
);

function listenerCount(emitter, type) {
  if ($isCallable(emitter.listenerCount)) {
    return emitter.listenerCount(type);
  }

  return jsEventTargetGetEventListenersCount(emitter, type);
}
Object.defineProperty(listenerCount, "name", { value: "listenerCount" });

function eventTargetAgnosticRemoveListener(emitter, name, listener, flags) {
  if (typeof emitter.removeListener === "function") {
    emitter.removeListener(name, listener);
  } else if (typeof emitter.removeEventListener === "function") {
    emitter.removeEventListener(name, listener, flags);
  } else {
    throw $ERR_INVALID_ARG_TYPE("emitter", "EventEmitter", emitter);
  }
}

function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
  if (typeof emitter.on === "function") {
    if (flags?.once) {
      emitter.once(name, listener);
    } else {
      emitter.on(name, listener);
    }
  } else if (typeof emitter.addEventListener === "function") {
    emitter.addEventListener(name, listener, flags);
  } else {
    throw $ERR_INVALID_ARG_TYPE("emitter", "EventEmitter", emitter);
  }
}

class AbortError extends Error {
  constructor(message = "The operation was aborted", options = undefined) {
    if (options !== undefined && typeof options !== "object") {
      throw $ERR_INVALID_ARG_TYPE("options", "object", options);
    }
    super(message, options);
    this.code = "ABORT_ERR";
    this.name = "AbortError";
  }
}

function checkListener(listener) {
  validateFunction(listener, "listener");
}

function _getMaxListeners(emitter) {
  return emitter?._maxListeners ?? defaultMaxListeners;
}

let AsyncResource = null;

function getMaxListeners(emitterOrTarget) {
  if (typeof emitterOrTarget?.getMaxListeners === "function") {
    return _getMaxListeners(emitterOrTarget);
  } else if (types.isEventTarget(emitterOrTarget)) {
    emitterOrTarget[kMaxEventTargetListeners] ??= defaultMaxListeners;
    return emitterOrTarget[kMaxEventTargetListeners];
  }
  throw $ERR_INVALID_ARG_TYPE("emitter", ["EventEmitter", "EventTarget"], emitterOrTarget);
}
Object.defineProperty(getMaxListeners, "name", { value: "getMaxListeners" });

// Copy-pasta from Node.js source code
function addAbortListener(signal, listener) {
  if (signal === undefined) {
    throw $ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  }

  validateAbortSignal(signal, "signal");
  if (typeof listener !== "function") {
    throw $ERR_INVALID_ARG_TYPE("listener", "function", listener);
  }

  let removeEventListener;
  if (signal.aborted) {
    queueMicrotask(() => listener());
  } else {
    signal.addEventListener("abort", listener, { __proto__: null, once: true });
    removeEventListener = () => {
      signal.removeEventListener("abort", listener);
    };
  }
  return {
    __proto__: null,
    [Symbol.dispose]() {
      removeEventListener?.();
    },
  };
}

class EventEmitterAsyncResource extends EventEmitter {
  triggerAsyncId;
  asyncResource;

  constructor(options) {
    if (!AsyncResource) {
      AsyncResource = require("node:async_hooks").AsyncResource;
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
    enumerable: true,
  },
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
    value: kMaxEventTargetListeners,
    enumerable: false,
    configurable: false,
    writable: false,
  },
  kMaxEventTargetListenersWarned: {
    value: kMaxEventTargetListenersWarned,
    enumerable: false,
    configurable: false,
    writable: false,
  },
});
Object.assign(EventEmitter, {
  once,
  on,
  getEventListeners,
  getMaxListeners,
  setMaxListeners,
  EventEmitter,
  usingDomains: false,
  captureRejectionSymbol,
  EventEmitterAsyncResource,
  errorMonitor: kErrorMonitor,
  addAbortListener,
  init: EventEmitter,
  listenerCount,
});

export default EventEmitter;
