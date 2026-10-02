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
  validateString,
} = require("internal/validators");
const { addAbortListener } = require("internal/abort_listener");
const { resistStopPropagation } = require("internal/shared");

const types = require("node:util/types");

// The prototype is a native object: `process` inherits from it too. It takes a method from
// internal/events/prototype when a program first reads that method.
const EventEmitterPrototype = $cpp("NodeEventEmitterPrototype.cpp", "Bun::nodeEventEmitterPrototype") as EventEmitter;
const { emitError, getDefaultMaxListeners, setDefaultMaxListeners } = require("internal/events/prototype");

const SymbolFor = Symbol.for;
const ArrayPrototypeUnshift = Array.prototype.unshift;

const kCapture = $cpp("NodeEventEmitterPrototype.cpp", "Bun::nodeEventEmitterCaptureSymbol") as symbol;
// Set when `_events` was preallocated (streams do this): removeListener then
// writes `undefined` instead of `delete`, keeping one shared JSC Structure
// so the (StructureID, name)-keyed megamorphic cache stays hot.
const kShapeMode = $cpp("NodeEventEmitterPrototype.cpp", "Bun::nodeEventEmitterShapeModeSymbol") as symbol;
const kErrorMonitor = SymbolFor("events.errorMonitor");
const kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners");
const kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned");
const kWatermarkData = SymbolFor("nodejs.watermarkData");
const kRejection = SymbolFor("nodejs.rejection");
const kFirstEventParam = SymbolFor("nodejs.kFirstEventParam");
const captureRejectionSymbol = SymbolFor("nodejs.rejection");

let FixedQueue;
const kEmptyObject = Object.freeze(Object.create(null));

interface Listener extends Function {
  listener?: Function;
}

interface ListenerList extends Array<Listener> {
  warned?: boolean;
}

type EventName = string | symbol;

declare class EventEmitter {
  constructor(opts?: { captureRejections?: boolean });
  _events?: Record<EventName, Listener | ListenerList | undefined>;
  _eventsCount: number;
  _maxListeners?: number;
  [kCapture]?: boolean;
  [kShapeMode]?: boolean;
  setMaxListeners(n: number): this;
  getMaxListeners(): number;
  emit(type: EventName, ...args: unknown[]): boolean;
  addListener(type: EventName, fn: Listener): this;
  on(type: EventName, fn: Listener): this;
  prependListener(type: EventName, fn: Listener): this;
  once(type: EventName, fn: Listener): this;
  prependOnceListener(type: EventName, fn: Listener): this;
  removeListener(type: EventName, listener: Listener): this;
  off(type: EventName, listener: Listener): this;
  removeAllListeners(type: EventName): this;
  listeners(type: EventName): Function[];
  rawListeners(type: EventName): Function[];
  listenerCount(type: EventName, method?: Function): number;
  eventNames(): EventName[];
}

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
EventEmitter.prototype = EventEmitterPrototype;

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
  const promise = $newPromise();
  const errorListener = err => {
    emitter.removeListener(type, resolver);
    if (signal != null) {
      eventTargetAgnosticRemoveListener(signal, "abort", abortListener);
    }
    $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, err);
  };
  const resolver = (...args) => {
    if (typeof emitter.removeListener === "function") {
      emitter.removeListener("error", errorListener);
    }
    if (signal != null) {
      eventTargetAgnosticRemoveListener(signal, "abort", abortListener);
    }
    $resolvePromiseWithFirstResolvingFunctionCallCheck(promise, args);
  };
  const opts = resistStopPropagation({ __proto__: null, once: true });
  eventTargetAgnosticAddListener(emitter, type, resolver, opts);
  if (type !== "error" && typeof emitter.once === "function") {
    // EventTarget does not have `error` event semantics like Node
    // EventEmitters, we listen to `error` events only on EventEmitters.
    emitter.once("error", errorListener);
  }
  function abortListener() {
    eventTargetAgnosticRemoveListener(emitter, type, resolver);
    eventTargetAgnosticRemoveListener(emitter, "error", errorListener);
    $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, $makeAbortError(undefined, { cause: signal?.reason }));
  }
  if (signal != null) {
    eventTargetAgnosticAddListener(signal, "abort", abortListener, opts);
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
            emitter.resume(); // Can not be finished yet
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
    paused = false;
    const doneResult = createIterResult(undefined, true);
    while (!unconsumedPromises.isEmpty()) {
      unconsumedPromises.shift().resolve(doneResult);
    }

    return Promise.$resolve(doneResult);
  }
}
Object.defineProperty(on, "name", { value: "on" });

function listenersController() {
  const listeners: [emitter: unknown, event: string | symbol, handler: Function, flags: unknown][] = [];

  return {
    addEventListener(emitter, event, handler, flags?) {
      eventTargetAgnosticAddListener(emitter, event, handler, flags);
      listeners.push([emitter, event, handler, flags]);
    },
    removeAll() {
      while (listeners.length > 0) {
        const [emitter, event, handler, flags] = listeners.pop()!;
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
function setMaxListeners(n = getDefaultMaxListeners(), ...eventTargets) {
  validateNumber(n, "setMaxListeners", 0);
  if (eventTargets.length === 0) {
    setDefaultMaxListeners(n);
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

  throw $ERR_INVALID_ARG_TYPE("emitter", ["EventEmitter", "EventTarget"], emitter);
}
Object.defineProperty(listenerCount, "name", { value: "listenerCount" });

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

let AsyncResource: typeof import("./async_hooks").default.AsyncResource | null = null;

function getMaxListeners(emitterOrTarget) {
  if (typeof emitterOrTarget?.getMaxListeners === "function") {
    return emitterOrTarget?._maxListeners ?? getDefaultMaxListeners();
  } else if (types.isEventTarget(emitterOrTarget)) {
    emitterOrTarget[kMaxEventTargetListeners] ??= getDefaultMaxListeners();
    return emitterOrTarget[kMaxEventTargetListeners];
  }
  throw $ERR_INVALID_ARG_TYPE("emitter", ["EventEmitter", "EventTarget"], emitterOrTarget);
}
Object.defineProperty(getMaxListeners, "name", { value: "getMaxListeners" });

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
      return getDefaultMaxListeners();
    },
    set: arg => {
      validateNumber(arg, "defaultMaxListeners", 0);
      setDefaultMaxListeners(arg);
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
