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

const {
  validateObject,
  validateInteger,
  validateAbortSignal,
  validateNumber,
  validateBoolean,
  validateFunction,
  validateString,
} = require("internal/validators");

const types = require("node:util/types");
let inspect: typeof import("node:util").inspect | undefined;

const SymbolFor = Symbol.for;
const ArrayPrototypeUnshift = Array.prototype.unshift;
const ReflectOwnKeys = Reflect.ownKeys;

const kCapture = Symbol("kCapture");
// Set when `_events` was preallocated (streams do this): removeListener then
// writes `undefined` instead of `delete`, keeping one shared JSC Structure
// so the (StructureID, name)-keyed megamorphic cache stays hot.
const kShapeMode = Symbol("shapeMode");
const kErrorMonitor = SymbolFor("events.errorMonitor");
const kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners");
const kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned");
const kWatermarkData = SymbolFor("nodejs.watermarkData");
const kRejection = SymbolFor("nodejs.rejection");
const kFirstEventParam = SymbolFor("nodejs.kFirstEventParam");
const captureRejectionSymbol = SymbolFor("nodejs.rejection");

let FixedQueue;
const kEmptyObject = Object.freeze(Object.create(null));

var defaultMaxListeners = 10;

// EventEmitter must be a standard function because some old code will do weird tricks like `EventEmitter.$apply(this)`.
function EventEmitter(opts) {
  if (this._events === undefined || this._events === this.__proto__._events) {
    this._events = Object.create(null);
    this._eventsCount = 0;
    this[kShapeMode] = false;
  } else {
    // Preallocated `_events` (streams). The count comes from the prototype
    // default `EventEmitterPrototype._eventsCount = 0`, as in node.
    this[kShapeMode] = true;
  }

  this._maxListeners ??= undefined;
  if (opts?.captureRejections) {
    // TODO: make validator functions return the validated value instead of validating and then coercing an extra time
    validateBoolean(opts.captureRejections, "options.captureRejections");
    this[kCapture] = !!opts.captureRejections;
    this.emit = emitWithRejectionCapture;
  } else {
    this[kCapture] = EventEmitterPrototype[kCapture];
    const capture = EventEmitterPrototype[kCapture];
    this[kCapture] = capture;
    if (capture) {
      this.emit = emitWithRejectionCapture;
    }
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
    if (errorMonitor !== undefined) {
      applyHandlers(errorMonitor, emitter, args);
    }

    const handlers = events.error;
    if (handlers !== undefined) {
      applyHandlers(handlers, emitter, args);
      return true;
    }
  }

  let er: Error | undefined;
  if (args.length > 0) er = args[0];

  if (Error.isError(er)) {
    throw er; // Unhandled 'error' event
  }

  let stringifiedEr;
  try {
    if (!inspect) inspect = require("internal/util/inspect").inspect;
    stringifiedEr = inspect!(er);
  } catch {
    stringifiedEr = er;
  }

  // At least give some kind of context to the user
  const err = $ERR_UNHANDLED_ERROR(stringifiedEr) as Error & { context: unknown };
  err.context = er;
  throw err; // Unhandled 'error' event
}

// A listener list is a bare function for a single listener, else an array
// (like node). Arrays are never mutated in place - mutators install a copy -
// so a stored list can be iterated with no defensive clone.
function applyHandlers(handlers, emitter, args) {
  if (typeof handlers === "function") {
    handlers.$apply(emitter, args);
    return;
  }
  for (let i = 0, { length } = handlers; i < length; i++) {
    handlers[i].$apply(emitter, args);
  }
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
  $debug(`${this.constructor?.name || "EventEmitter"}.emit`, type);

  if (type === "error") {
    return emitError(this, args);
  }
  var { _events: events } = this;
  if (events === undefined) return false;
  var handler = events[type];
  if (handler === undefined) return false;
  // For performance reasons Function.call(...) is used whenever possible.
  if (typeof handler === "function") {
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
    return true;
  }
  // No defensive clone: stored arrays are never mutated in place (mutators
  // install a copy), so this list stays stable for the whole loop even if a
  // listener adds/removes listeners.
  for (let i = 0, { length } = handler; i < length; i++) {
    const listener = handler[i];
    switch (args.length) {
      case 0:
        listener.$call(this);
        break;
      case 1:
        listener.$call(this, args[0]);
        break;
      case 2:
        listener.$call(this, args[0], args[1]);
        break;
      case 3:
        listener.$call(this, args[0], args[1], args[2]);
        break;
      default:
        listener.$apply(this, args);
        break;
    }
  }
  return true;
};

const emitWithRejectionCapture = function emit(type, ...args) {
  $debug(`${this.constructor?.name || "EventEmitter"}.emit`, type);
  if (type === "error") {
    return emitError(this, args);
  }
  var { _events: events } = this;
  if (events === undefined) return false;
  var handler = events[type];
  if (handler === undefined) return false;
  // For performance reasons Function.call(...) is used whenever possible.
  if (typeof handler === "function") {
    let result;
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
    return true;
  }
  // No defensive clone: stored arrays are never mutated in place (mutators
  // install a copy), so this list stays stable for the whole loop even if a
  // listener adds/removes listeners.
  for (let i = 0, { length } = handler; i < length; i++) {
    const listener = handler[i];
    let result;
    switch (args.length) {
      case 0:
        result = listener.$call(this);
        break;
      case 1:
        result = listener.$call(this, args[0]);
        break;
      case 2:
        result = listener.$call(this, args[0], args[1]);
        break;
      case 3:
        result = listener.$call(this, args[0], args[1], args[2]);
        break;
      default:
        result = listener.$apply(this, args);
        break;
    }
    if (result !== undefined && $isPromise(result)) {
      addCatch(this, result, type, args);
    }
  }
  return true;
};

EventEmitterPrototype.emit = emitWithoutRejectionCapture;

function _addListener(target, type, fn, prepend) {
  checkListener(fn);
  var events = target._events;
  if (!events) {
    events = target._events = Object.create(null);
    target._eventsCount = 0;
  } else if (events.newListener) {
    target.emit("newListener", type, fn.listener ?? fn);
    // A newListener handler can replace `_events` (e.g. a once wrapper's
    // removeListener dropping the count to 0 installs a fresh object).
    events = target._events;
  }
  var existing = events[type];
  if (existing === undefined) {
    // A single listener is stored bare, like node, so this allocates nothing.
    events[type] = fn;
    target._eventsCount++;
    return;
  }
  var handlers;
  if (typeof existing === "function") {
    handlers = events[type] = prepend ? [fn, existing] : [existing, fn];
  } else {
    handlers = events[type] = copyWithInserted(existing, fn, prepend);
  }
  var m = _getMaxListeners(target);
  if (m > 0 && handlers.length > m && !handlers.warned) {
    overflowWarning(target, type, handlers);
  }
}

EventEmitterPrototype.addListener = function addListener(type, fn) {
  _addListener(this, type, fn, false);
  return this;
};

EventEmitterPrototype.on = EventEmitterPrototype.addListener;

EventEmitterPrototype.prependListener = function prependListener(type, fn) {
  _addListener(this, type, fn, true);
  return this;
};

// Copy-on-write: emit iterates stored arrays with no clone, so new listeners
// land in a fresh array; `warned` carries over so the leak warning fires once.
// An inline loop beats concat/slice here ~10x (host-call boundary).
function copyWithInserted(list, fn, prepend) {
  const n = list.length;
  const copy = $newArrayWithSize(n + 1);
  // Two straight copies, not a per-element ternary (measured ~25% slower).
  if (prepend) {
    copy[0] = fn;
    for (let i = 0; i < n; i++) copy[i + 1] = list[i];
  } else {
    for (let i = 0; i < n; i++) copy[i] = list[i];
    copy[n] = fn;
  }
  if (list.warned) copy.warned = true;
  return copy;
}

function overflowWarning(emitter, type, handlers) {
  if (!inspect) inspect = require("internal/util/inspect").inspect;
  handlers.warned = true;
  const warn = new Error(
    `Possible EventEmitter memory leak detected. ${handlers.length} ${String(type)} listeners added to ${inspect!(emitter, { depth: -1 })}. MaxListeners is ${_getMaxListeners(emitter)}. Use emitter.setMaxListeners() to increase limit`,
  );
  warn.name = "MaxListenersExceededWarning";
  warn.emitter = emitter;
  warn.type = type;
  warn.count = handlers.length;
  process.emitWarning(warn);
}

// A closure over (target, type, listener, fired) rather than a state object
// plus onceWrapper.bind(state): one allocation instead of two per once().
function _onceWrap(target, type, listener) {
  let fired = false;
  // Named `onceWrapper` so inspect/rawListeners() output tracks node's.
  const wrapped = function onceWrapper() {
    if (!fired) {
      fired = true;
      // Drop closure refs so anything that retains the fired wrapper (a cached
      // rawListeners() result, the COW array emit() is iterating) does not
      // retain the emitter. `wrapped.listener` stays: node asserts it survives.
      const t = target;
      const l = listener;
      target = undefined;
      listener = undefined;
      t.removeListener(type, wrapped);
      if (arguments.length === 0) return l.$call(t);
      return l.$apply(t, arguments);
    }
  };
  wrapped.listener = listener;
  return wrapped;
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

  if (typeof list === "function") {
    // Bare single listener.
    if (list !== listener && list.listener !== listener) return this;
    this._eventsCount--;
    if (this[kShapeMode]) {
      // Keep the preallocated slot; just clear it.
      events[type] = undefined;
    } else if (this._eventsCount === 0) {
      // Fresh object: drops any add/delete transition history rather than
      // letting a long-lived emitter's Structure chain grow toward dictionary.
      this._events = Object.create(null);
    } else {
      delete events[type];
    }
    if (events.removeListener !== undefined) this.emit("removeListener", type, list.listener ?? listener);
    return this;
  }

  let position = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] === listener || list[i].listener === listener) {
      position = i;
      break;
    }
  }
  if (position < 0) return this;

  // Copy-remove (arrays are never mutated in place), and store a lone
  // survivor bare like node does, so `_events[type]` shape matches theirs.
  const n = list.length;
  const copy = $newArrayWithSize(n - 1);
  for (let i = 0, j = 0; i < n; i++) {
    if (i !== position) copy[j++] = list[i];
  }
  if (list.warned) copy.warned = true;
  events[type] = copy.length === 1 ? copy[0] : copy;

  if (events.removeListener !== undefined) this.emit("removeListener", type, listener.listener ?? listener);

  return this;
};

EventEmitterPrototype.off = EventEmitterPrototype.removeListener;

EventEmitterPrototype.removeAllListeners = function removeAllListeners(type) {
  const events = this._events;
  if (events === undefined) return this;

  // Not listening for removeListener, no need to emit
  if (events.removeListener === undefined) {
    if (arguments.length === 0) {
      this._events = Object.create(null);
      this._eventsCount = 0;
    } else if (events[type] !== undefined) {
      if (--this._eventsCount === 0) this._events = Object.create(null);
      else delete events[type];
    }
    this[kShapeMode] = false;
    return this;
  }

  // Emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (const key of ReflectOwnKeys(events)) {
      if (key === "removeListener") continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners("removeListener");
    this._events = Object.create(null);
    this._eventsCount = 0;
    this[kShapeMode] = false;
    return this;
  }

  const listeners = events[type];
  if (typeof listeners === "function") {
    this.removeListener(type, listeners);
  } else if (listeners !== undefined) {
    // LIFO order. `listeners` is our own snapshot; each removeListener call
    // installs a fresh array (or bare fn / nothing), so it stays intact here.
    for (let i = listeners.length - 1; i >= 0; i--) this.removeListener(type, listeners[i]);
  }
  return this;
};

EventEmitterPrototype.listeners = function listeners(type) {
  var { _events: events } = this;
  if (!events) return [];
  var handlers = events[type];
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers.listener ?? handlers];
  return handlers.map(x => x.listener ?? x);
};

EventEmitterPrototype.rawListeners = function rawListeners(type) {
  var { _events } = this;
  if (!_events) return [];
  var handlers = _events[type];
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers];
  return handlers.slice();
};

EventEmitterPrototype.listenerCount = function listenerCount(type, method) {
  if (method == null) return listenerCountSlow(this, type);
  var handlers = this._events?.[type];
  if (!handlers) return 0;
  if (typeof handlers === "function") return handlers === method || handlers.listener === method ? 1 : 0;
  var length = 0;
  for (let i = 0; i < handlers.length; i++) {
    const handler = handlers[i];
    if (handler === method || handler.listener === method) {
      length++;
    }
  }
  return length;
};
Object.defineProperty(EventEmitterPrototype.listenerCount, "name", { value: "listenerCount" });

EventEmitterPrototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

EventEmitterPrototype[kCapture] = false;
// Prototype default, like node: the shape-mode constructor branch (a
// preallocated _events object, i.e. every stream) skips the own-property
// init, so without this the count is undefined and every ++/-- yields NaN.
EventEmitterPrototype._eventsCount = 0;

// `async` so the validation/already-aborted `throw`s below surface as a
// rejected promise instead of a synchronous throw — matches Node, whose
// `once` is also an async function (`once.constructor.name === "AsyncFunction"`).
async function once(emitter, type, options = kEmptyObject) {
  validateObject(options, "options");
  var signal = options?.signal;
  validateAbortSignal(signal, "options.signal");
  if (signal?.aborted) {
    throw $makeAbortError(undefined, { cause: signal?.reason });
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
    reject($makeAbortError(undefined, { cause: signal?.reason }));
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
  if (signal?.aborted) throw $makeAbortError(undefined, { cause: signal?.reason });
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
          return Promise.$resolve(createIterResult(value, false));
        }

        // Then we error, if an error happened
        // This happens one time if at all, because after 'error'
        // we stop listening
        if (error) {
          const p = Promise.$reject(error);
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
    errorHandler($makeAbortError(undefined, { cause: signal?.reason }));
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

    return Promise.$resolve(doneResult);
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

  // EventTarget
  const evt_count = jsEventTargetGetEventListenersCount(emitter, type);
  if (evt_count !== undefined) return evt_count;

  // EventEmitter's with no `.listenerCount`
  return listenerCountSlow(emitter, type);
}
Object.defineProperty(listenerCount, "name", { value: "listenerCount" });

function listenerCountSlow(emitter, type) {
  const events = emitter._events;
  if (events !== undefined) {
    const evlistener = events[type];
    if (typeof evlistener === "function") {
      return 1;
    } else if (evlistener !== undefined) {
      return evlistener.length;
    }
  }
  return 0;
}

function eventTargetAgnosticRemoveListener(emitter, name, listener, flags?) {
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

let EventEmitterReferencingAsyncResource;
function lazyLoadAsyncResource() {
  if (!AsyncResource) {
    AsyncResource = require("node:async_hooks").AsyncResource;
    EventEmitterReferencingAsyncResource = class EventEmitterReferencingAsyncResource extends AsyncResource {
      #eventEmitter;

      constructor(ee, type, options) {
        super(type, options);
        this.#eventEmitter = ee;
      }

      get eventEmitter() {
        return this.#eventEmitter;
      }
    };
  }
}

class EventEmitterAsyncResource extends EventEmitter {
  #asyncResource;

  constructor(options) {
    lazyLoadAsyncResource();
    let name;
    if (typeof options === "string") {
      name = options;
      options = undefined;
    } else {
      if (new.target === EventEmitterAsyncResource) {
        validateString(options?.name, "options.name");
      }
      name = options?.name || new.target.name;
    }
    super(options);
    this.#asyncResource = new EventEmitterReferencingAsyncResource(this, name, options);
    // EventEmitter's constructor stamps `this.emit = emitWithRejectionCapture`
    // as an OWN property when captureRejections is on, which would shadow the
    // prototype's runInAsyncScope-wrapped emit below. Remove it so listeners
    // still run in the resource's async scope; the prototype emit re-checks
    // this[kCapture] on every call, so rejection capture is preserved. delete
    // is a no-op when the property is absent, so no own-property check needed.
    delete (this as { emit? }).emit;
  }

  // No explicit receiver guards: like node v26 (lib/events.js), the private
  // field access itself brand-checks `this` and throws a TypeError on a wrong
  // receiver, so an ERR_INVALID_THIS guard before it would be unreachable.
  get asyncId() {
    return this.#asyncResource.asyncId();
  }

  get triggerAsyncId() {
    return this.#asyncResource.triggerAsyncId();
  }

  get asyncResource() {
    return this.#asyncResource;
  }

  emit(event, ...args) {
    const asyncResource = this.#asyncResource;
    // The base EventEmitter picks its emit variant by stamping an own property;
    // that own property is deleted in the constructor above, so pick per-call
    // from this[kCapture]. The default branch reads super.emit at call time
    // (Node routes through super.emit) so a userland monkeypatch of
    // EventEmitter.prototype.emit is observed like it is for plain emitters.
    const emit = this[kCapture] ? emitWithRejectionCapture : super.emit;
    ArrayPrototypeUnshift.$call(args, emit, this, event);
    return asyncResource.runInAsyncScope.$apply(asyncResource, args);
  }

  emitDestroy() {
    this.#asyncResource.emitDestroy();
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

export default EventEmitter as any as typeof import("node:events");
