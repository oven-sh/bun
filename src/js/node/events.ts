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

// Add minimal DOM type definitions if not globally available
// This avoids pulling in full 'lib.dom.d.ts' if not needed by the build setup
// Note: These are already globally available via lib.dom.d.ts usually,
// but explicitly defining them here ensures they exist if lib.dom is excluded.
// We remove the local AbortSignal definition as it conflicts (TS2687)
declare global {
  interface EventListenerOptions {
    capture?: boolean;
  }

  interface AddEventListenerOptions extends EventListenerOptions {
    once?: boolean;
    passive?: boolean;
    signal?: AbortSignal;
  }

  interface EventListener {
    (evt: Event): void;
  }

  interface EventListenerObject {
    handleEvent(object: Event): void;
  }

  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

  // Extend EventTarget to align with Node.js expectations if necessary
  interface EventTarget {
    [kMaxEventTargetListeners]?: number;
    [kMaxEventTargetListenersWarned]?: boolean;
    // Ensure these methods accept symbols as well, if not already covered by lib.dom.d.ts
    addEventListener(
      type: string | symbol,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(
      type: string | symbol,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ): void;
  }
}

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

let FixedQueue: any; // Use any for FixedQueue type
const kEmptyObject = Object.freeze(Object.create(null));

var defaultMaxListeners = 10;

interface EventEmitterOptions {
  captureRejections?: boolean;
}

// Use index signature for symbols to avoid TS1169 with Symbol.for
// Also includes internal properties used by the class implementation.
interface EventEmitterPrivate {
  _events: Record<string | symbol, ((...args: any[]) => any)[] | undefined> | undefined;
  _eventsCount: number;
  _maxListeners: number | undefined;
  // Allow symbol properties like kCapture, kRejection, etc.
  [key: symbol]: any;
}

// Helper function to get _maxListeners or default
function _getMaxListeners(emitter: EventEmitterPrivate): number {
  return emitter._maxListeners ?? defaultMaxListeners;
}

// Helper function to emit errors, used by both emit variants
function emitErrorHelper(emitter: EventEmitter, args: any[]) {
  const emitterPrivate = emitter as unknown as EventEmitterPrivate;
  var { _events: events } = emitterPrivate;

  if (events !== undefined) {
    const errorMonitor = events[kErrorMonitor];
    if (errorMonitor) {
      // Use a standard for loop for performance
      for (let i = 0; i < errorMonitor.length; i++) {
        errorMonitor[i].$apply(emitter, args);
      }
    }

    const handlers = events.error;
    if (handlers) {
      // Use a standard for loop for performance
      for (let i = 0; i < handlers.length; i++) {
        handlers[i].$apply(emitter, args);
      }
      return true;
    }
  }

  let er: Error | undefined;
  if (args.length > 0) er = args[0];

  if (types.isNativeError(er)) {
    throw er; // Unhandled 'error' event
  }

  let stringifiedEr;
  try {
    stringifiedEr = inspect(er);
  } catch {
    stringifiedEr = er;
  }

  // At least give some kind of context to the user
  const err = $ERR_UNHANDLED_ERROR(stringifiedEr) as Error & { context: unknown };
  err.context = er;
  throw err; // Unhandled 'error' event
}

// Helper function for rejection handling
function addCatch(emitter: EventEmitter, promise: Promise<any>, type: string | symbol, args: any[]) {
  const emitterPrivate = emitter as unknown as EventEmitterPrivate;
  promise.then(undefined, function (err) {
    // The callback is called with nextTick to avoid a follow-up rejection from this promise.
    process.nextTick(emitUnhandledRejectionOrErr, emitterPrivate, err, type, args);
  });
}

// Helper function for rejection handling
function emitUnhandledRejectionOrErr(emitter: EventEmitterPrivate, err: Error, type: string | symbol, args: any[]) {
  if (typeof emitter[kRejection] === "function") {
    emitter[kRejection](err, type, ...args);
  } else {
    // If the error handler throws, it is not catchable and it will end up in 'uncaughtException'.
    // We restore the previous value of kCapture in case the uncaughtException is present
    // and the exception is handled.
    const prevCapture = emitter[kCapture];
    try {
      emitter[kCapture] = false;
      // Use the public emit method here
      (emitter as unknown as EventEmitter).emit("error", err);
    } finally {
      emitter[kCapture] = prevCapture;
    }
  }
}

// Helper to check listener argument
function checkListener(listener: any) {
  validateFunction(listener, "listener");
}

// Helper for memory leak warnings
interface MaxListenersExceededWarning extends Error {
  emitter: EventEmitter;
  type: string | symbol;
  count: number;
}

function overflowWarning(emitter: EventEmitterPrivate, type: string | symbol, handlers: ((...args: any[]) => any)[]) {
  (handlers as any).warned = true;
  const warn = new Error(
    `Possible EventTarget memory leak detected. ${handlers.length} ${String(type)} listeners added to ${inspect(emitter, { depth: -1 })}. MaxListeners is ${emitter._maxListeners}. Use events.setMaxListeners() to increase limit`,
  ) as MaxListenersExceededWarning;
  warn.name = "MaxListenersExceededWarning";
  warn.emitter = emitter as unknown as EventEmitter;
  warn.type = type;
  warn.count = handlers.length;
  process.emitWarning(warn);
}

// Helper for once listeners
interface OnceWrapperState {
  fired: boolean;
  wrapFn: ((...args: any[]) => any) | undefined;
  target: EventEmitter; // Use public EventEmitter type
  type: string | symbol;
  listener: (...args: any[]) => any;
}

function _onceWrap(target: EventEmitter, type: string | symbol, listener: (...args: any[]) => any) {
  const state: OnceWrapperState = { fired: false, wrapFn: undefined, target, type, listener };
  const wrapped = onceWrapper.bind(state);
  (wrapped as any).listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

function onceWrapper(this: OnceWrapperState, ...args: any[]) {
  if (!this.fired) {
    // Use ! assertion as wrapFn is assigned immediately after creation in _onceWrap
    this.target.removeListener(this.type, this.wrapFn!);
    this.fired = true;
    if (args.length === 0) return this.listener.$call(this.target);
    return this.listener.$apply(this.target, args);
  }
}

// Convert to ES6 class
class EventEmitter {
  // Explicitly declare properties for clarity, matching EventEmitterPrivate
  _events: Record<string | symbol, ((...args: any[]) => any)[] | undefined> | undefined;
  _eventsCount: number = 0; // Initialize here
  _maxListeners: number | undefined;
  // Allow symbol properties like kCapture, kRejection, etc.
  [key: symbol]: any;

  // Static properties need to be defined outside the class body or using static keyword
  static captureRejections = false;
  static defaultMaxListeners = defaultMaxListeners;
  static errorMonitor = kErrorMonitor;
  static kMaxEventTargetListeners = kMaxEventTargetListeners;
  static kMaxEventTargetListenersWarned = kMaxEventTargetListenersWarned;

  constructor(opts?: EventEmitterOptions) {
    // Use 'this' which refers to the instance (EventEmitterPrivate equivalent)
    if (this._events === undefined || this._events === (Object.getPrototypeOf(this) as any)._events) {
      this._events = Object.create(null);
      this._eventsCount = 0; // Ensure it's initialized even if _events existed on prototype
    }

    this._maxListeners ??= undefined;
    if (opts?.captureRejections) {
      validateBoolean(opts.captureRejections, "options.captureRejections");
      this[kCapture] = true;
      // Overwrite emit for this instance if captureRejections is true
      this.emit = this.emitWithRejectionCapture;
    } else {
      // Inherit kCapture from prototype or set default
      this[kCapture] = (this.constructor as typeof EventEmitter).captureRejections;
      // Ensure the standard emit is used
      this.emit = this.emitWithoutRejectionCapture;
    }
  }

  setMaxListeners(n: number): this {
    validateNumber(n, "setMaxListeners", 0);
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return _getMaxListeners(this as unknown as EventEmitterPrivate);
  }

  emit(type: string | symbol, ...args: any[]): boolean {
    // Default implementation points to the non-capturing version
    return this.emitWithoutRejectionCapture(type, ...args);
  }

  // Separate method for the non-capturing emit logic
  emitWithoutRejectionCapture(type: string | symbol, ...args: any[]): boolean {
    $debug(`${(this as any).constructor?.name || "EventEmitter"}.emit`, type);

    if (type === "error") {
      return emitErrorHelper(this, args);
    }
    var { _events: events } = this;
    if (events === undefined) return false;
    var handlers = events[type];
    if (handlers === undefined) return false;

    const maybeClonedHandlers = handlers.length > 1 ? handlers.slice() : handlers;
    for (let i = 0, { length } = maybeClonedHandlers; i < length; i++) {
      const handler = maybeClonedHandlers[i];
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
  }

  // Separate method for the capturing emit logic
  emitWithRejectionCapture(type: string | symbol, ...args: any[]): boolean {
    $debug(`${(this as any).constructor?.name || "EventEmitter"}.emit`, type);
    if (type === "error") {
      return emitErrorHelper(this, args);
    }
    var { _events: events } = this;
    if (events === undefined) return false;
    var handlers = events[type];
    if (handlers === undefined) return false;

    const maybeClonedHandlers = handlers.length > 1 ? handlers.slice() : handlers;
    for (let i = 0, { length } = maybeClonedHandlers; i < length; i++) {
      const handler = maybeClonedHandlers[i];
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
    }
    return true;
  }

  addListener(type: string | symbol, fn: (...args: any[]) => any): this {
    checkListener(fn);
    var events = this._events;
    if (!events) {
      events = this._events = Object.create(null);
      this._eventsCount = 0;
    } else if (events.newListener) {
      this.emit("newListener", type, (fn as any).listener ?? fn);
    }
    var handlers = events![type]; // TS18048 fixed with !
    if (!handlers) {
      events![type] = [fn]; // TS18048 fixed with !
      this._eventsCount++;
    } else {
      handlers.push(fn);
      var m = _getMaxListeners(this as unknown as EventEmitterPrivate);
      if (m > 0 && handlers.length > m && !(handlers as any).warned) {
        overflowWarning(this as unknown as EventEmitterPrivate, type, handlers);
      }
    }
    return this;
  }

  on(type: string | symbol, fn: (...args: any[]) => any): this {
    return this.addListener(type, fn);
  }

  prependListener(type: string | symbol, fn: (...args: any[]) => any): this {
    checkListener(fn);
    var events = this._events;
    if (!events) {
      events = this._events = Object.create(null);
      this._eventsCount = 0;
    } else if (events.newListener) {
      this.emit("newListener", type, (fn as any).listener ?? fn);
    }
    var handlers = events![type]; // TS18048 fixed with !
    if (!handlers) {
      events![type] = [fn]; // TS18048 fixed with !
      this._eventsCount++;
    } else {
      handlers.unshift(fn);
      var m = _getMaxListeners(this as unknown as EventEmitterPrivate);
      if (m > 0 && handlers.length > m && !(handlers as any).warned) {
        overflowWarning(this as unknown as EventEmitterPrivate, type, handlers);
      }
    }
    return this;
  }

  once(type: string | symbol, fn: (...args: any[]) => any): this {
    checkListener(fn);
    this.on(type, _onceWrap(this, type, fn));
    return this;
  }

  prependOnceListener(type: string | symbol, fn: (...args: any[]) => any): this {
    checkListener(fn);
    this.prependListener(type, _onceWrap(this, type, fn));
    return this;
  }

  removeListener(type: string | symbol, listener: (...args: any[]) => any): this {
    checkListener(listener);

    const events = this._events;
    if (events === undefined) return this;

    const list = events[type];
    if (list === undefined) return this;

    let position = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === listener || (list[i] as any).listener === listener) {
        position = i;
        break;
      }
    }
    if (position < 0) return this;

    if (position === 0) list.shift();
    else ArrayPrototypeSplice.$call(list, position, 1);

    if (list.length === 0) {
      delete events[type];
      // Only decrement if the key actually existed
      if (this._eventsCount > 0) {
        this._eventsCount--;
      }
    }

    if (events!.removeListener !== undefined) this.emit("removeListener", type, (listener as any).listener || listener); // TS18048 fixed with !

    return this;
  }

  off(type: string | symbol, listener: (...args: any[]) => any): this {
    return this.removeListener(type, listener);
  }

  removeAllListeners(type?: string | symbol): this {
    const events = this._events;
    if (events === undefined) {
      return this;
    }

    // Cache removeListener handlers before modifying _events
    const removeListenerHandlers = events.removeListener;
    const hasRemoveListener = removeListenerHandlers !== undefined;

    if (type === undefined) {
      // Remove all listeners for all types
      const keys = ReflectOwnKeys(events);
      const originalEvents = this._events; // Keep a reference to the original map

      // Reset state first
      this._events = Object.create(null);
      this._eventsCount = 0;

      if (hasRemoveListener && originalEvents) {
        for (const key of keys) {
          if (key === "removeListener") continue;
          const listeners = originalEvents[key];
          if (listeners) {
            // Emit in LIFO order using the original listeners list
            for (let i = listeners.length - 1; i >= 0; i--) {
              this.emit("removeListener", key, (listeners[i] as any).listener || listeners[i]);
            }
          }
        }
        // Emit for the 'removeListener' handlers themselves last
        if (removeListenerHandlers) {
          for (let i = removeListenerHandlers.length - 1; i >= 0; i--) {
            this.emit("removeListener", "removeListener", (removeListenerHandlers[i] as any).listener || removeListenerHandlers[i]);
          }
        }
      }
    } else {
      // Remove listeners for a specific type
      const list = events[type];
      if (list !== undefined) {
        const listenersToRemove = list.slice(); // Copy for safe iteration
        delete events[type];
        if (this._eventsCount > 0) {
          // Decrement count by the number of listeners removed for this type
          this._eventsCount -= listenersToRemove.length;
        }
        // If events becomes empty after deletion, reset _events and _eventsCount
        if (this._eventsCount === 0) {
          this._events = Object.create(null);
        }

        if (hasRemoveListener) {
          // Emit in LIFO order
          for (let i = listenersToRemove.length - 1; i >= 0; i--) {
            this.emit("removeListener", type, (listenersToRemove[i] as any).listener || listenersToRemove[i]);
          }
        }
      }
    }

    return this;
  }

  listeners(type: string | symbol): ((...args: any[]) => any)[] {
    var { _events: events } = this;
    if (!events) return [];
    var handlers = events[type];
    if (!handlers) return [];
    return handlers.map(x => (x as any).listener ?? x);
  }

  rawListeners(type: string | symbol): ((...args: any[]) => any)[] {
    var { _events } = this;
    if (!_events) return [];
    var handlers = _events[type];
    if (!handlers) return [];
    return handlers.slice();
  }

  listenerCount(type: string | symbol, method?: (...args: any[]) => any): number {
    var { _events: events } = this;
    if (!events) return 0;
    const list = events[type];
    if (!list) return 0;
    if (method != null) {
      var length = 0;
      for (const handler of list) {
        if (handler === method || (handler as any).listener === method) {
          length++;
        }
      }
      return length;
    }
    return list.length;
  }

  eventNames(): (string | symbol)[] {
    // Use Reflect.ownKeys which includes symbols
    return this._events ? ReflectOwnKeys(this._events) : [];
  }
}

// Initialize static properties after class definition
EventEmitter.captureRejections = false;
EventEmitter.defaultMaxListeners = 10; // Re-assign defaultMaxListeners here
EventEmitter.errorMonitor = kErrorMonitor;
EventEmitter.kMaxEventTargetListeners = kMaxEventTargetListeners;
EventEmitter.kMaxEventTargetListenersWarned = kMaxEventTargetListenersWarned;

// Assign the correct default emit method to the prototype
(EventEmitter.prototype as any).emit = EventEmitter.prototype.emitWithoutRejectionCapture;
// Assign the initial kCapture value to the prototype
(EventEmitter.prototype as any)[kCapture] = false;

interface OnceOptions {
  signal?: AbortSignal;
}

function once(emitter: EventEmitter | EventTarget, type: string | symbol, options: OnceOptions = kEmptyObject as OnceOptions) {
  validateObject(options, "options");
  var signal = options?.signal;
  validateAbortSignal(signal, "options.signal");
  if (signal?.aborted) {
    throw $makeAbortError(undefined, { cause: signal?.reason });
  }
  const { resolve, reject, promise } = $newPromiseCapability(Promise);

  const errorListener = (err: Error) => {
    // Remove listeners
    eventTargetAgnosticRemoveListener(emitter, "error", errorListener);
    eventTargetAgnosticRemoveListener(emitter, type, resolver);
    if (signal != null) {
      // Use undefined for options as capture flag is false and once is handled by the promise logic
      eventTargetAgnosticRemoveListener(signal, "abort", abortListener, undefined);
    }
    reject(err);
  };

  const resolver = (...args: any[]) => {
    // Check if emitter is EventEmitter before removing 'error' listener
    if (typeof (emitter as EventEmitter).removeListener === "function") {
      (emitter as EventEmitter).removeListener("error", errorListener);
    }
    if (signal != null) {
      eventTargetAgnosticRemoveListener(signal, "abort", abortListener, undefined);
    }
    resolve(args);
  };

  // Add the main listener with once: true
  eventTargetAgnosticAddListener(emitter, type, resolver, { once: true });

  if (type !== "error" && typeof (emitter as EventEmitter).once === "function") {
    // EventTarget does not have `error` event semantics like Node
    // EventEmitters, we listen to `error` events only on EventEmitters.
    // Add error listener with once: true
    eventTargetAgnosticAddListener(emitter, "error", errorListener, { once: true });
  }

  function abortListener() {
    // Remove listeners
    eventTargetAgnosticRemoveListener(emitter, type, resolver);
    if (typeof (emitter as EventEmitter).removeListener === "function") {
      (emitter as EventEmitter).removeListener("error", errorListener);
    }
    reject($makeAbortError(undefined, { cause: signal?.reason }));
  }

  if (signal != null) {
    // Add abort listener with once: true
    eventTargetAgnosticAddListener(signal, "abort", abortListener, { once: true });
  }

  return promise;
}
Object.defineProperty(once, "name", { value: "once" });

const AsyncIteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(async function* () {}).prototype);
function createIterResult(value: any, done: boolean) {
  return { value, done };
}

interface OnOptions {
  signal?: AbortSignal;
  highWaterMark?: number;
  highWatermark?: number;
  lowWaterMark?: number;
  lowWatermark?: number;
  close?: string[];
  // Allow symbol properties
  [key: symbol]: any;
}

function on(emitter: EventEmitter & { pause?(): void; resume?(): void }, event: string | symbol, options: OnOptions = kEmptyObject as OnOptions) {
  // Parameters validation
  validateObject(options, "options");
  const signal = options?.signal;
  validateAbortSignal(signal, "options.signal");
  if (signal?.aborted) throw $makeAbortError(undefined, { cause: signal?.reason });
  // Support both highWaterMark and highWatermark for backward compatibility
  const highWatermark = options?.highWaterMark ?? options?.highWatermark ?? Number.MAX_SAFE_INTEGER;
  validateInteger(highWatermark, "options.highWaterMark", 1);
  // Support both lowWaterMark and lowWatermark for backward compatibility
  const lowWatermark = options?.lowWaterMark ?? options?.lowWatermark ?? 1;
  validateInteger(lowWatermark, "options.lowWaterMark", 1);

  // Preparing controlling queues and variables
  FixedQueue ??= require("internal/fixed_queue").FixedQueue;
  const unconsumedEvents = new FixedQueue();
  const unconsumedPromises = new FixedQueue();
  let paused = false;
  let error: Error | null = null;
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
            emitter.resume?.();
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

      throw(err: Error) {
        if (!err || !(types.isNativeError(err))) {
          throw $ERR_INVALID_ARG_TYPE("EventEmitter.AsyncIterator", "Error", err);
        }
        errorHandler(err);
        return Promise.reject(err);
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
      : function (...args: any[]) {
          return eventHandler(args);
        },
    undefined,
  );
  if (event !== "error" && typeof emitter.on === "function") {
    addEventListener(emitter, "error", errorHandler, undefined);
  }
  const closeEvents = options?.close;
  if (closeEvents?.length) {
    for (let i = 0; i < closeEvents.length; i++) {
      addEventListener(emitter, closeEvents[i], closeHandler, undefined);
    }
  }

  const abortListenerDisposable = signal ? addAbortListener(signal, abortListener) : null;

  return iterator;

  function abortListener() {
    errorHandler($makeAbortError(undefined, { cause: signal?.reason }));
  }

  function eventHandler(value: any) {
    if (unconsumedPromises.isEmpty()) {
      size++;
      if (!paused && size > highWatermark) {
        paused = true;
        emitter.pause?.();
      }
      unconsumedEvents.push(value);
    } else unconsumedPromises.shift().resolve(createIterResult(value, false));
  }

  function errorHandler(err: Error) {
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
  const listeners: [any, string | symbol, (...args: any[]) => any, any][] = [];

  return {
    addEventListener(emitter: any, event: string | symbol, handler: (...args: any[]) => any, flags: any) {
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

const getEventListenersForEventTarget = $newCppFunction<(emitter: EventTarget, type: string | symbol) => ((...args: any[]) => any)[]>(
  "JSEventTargetNode.cpp",
  "jsFunctionNodeEventsGetEventListeners",
  1,
);

function getEventListeners(emitter: EventEmitter | EventTarget, type: string | symbol): ((...args: any[]) => any)[] {
  if (typeof (emitter as EventEmitter)?.listeners === "function") {
    return (emitter as EventEmitter).listeners(type);
  } else if (types.isEventTarget(emitter)) {
    return getEventListenersForEventTarget(emitter as EventTarget, type);
  }
  // Fallback for objects that might quack like EventEmitter but aren't instances
  if (typeof (emitter as any)?._events?.[type] !== 'undefined') {
    const listeners = (emitter as any)._events[type];
    return Array.isArray(listeners) ? listeners.map((l: any) => l.listener ?? l) : [(listeners as any).listener ?? listeners];
  }
  return [];
}

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/events.js#L315-L339
function setMaxListeners(n = defaultMaxListeners, ...eventTargets: (EventEmitter | EventTarget)[]) {
  validateNumber(n, "setMaxListeners", 0);
  if (eventTargets.length === 0) {
    // Update the static default on the class and the module-level variable
    EventEmitter.defaultMaxListeners = n;
    defaultMaxListeners = n;
  } else {
    for (let i = 0; i < eventTargets.length; i++) {
      const target = eventTargets[i];
      if (types.isEventTarget(target)) {
        (target as any)[kMaxEventTargetListeners] = n;
        (target as any)[kMaxEventTargetListenersWarned] = false;
      } else if (typeof (target as EventEmitter).setMaxListeners === "function") {
        (target as EventEmitter).setMaxListeners(n);
      } else {
        throw $ERR_INVALID_ARG_TYPE("eventTargets", ["EventEmitter", "EventTarget"], target);
      }
    }
  }
}
Object.defineProperty(setMaxListeners, "name", { value: "setMaxListeners" });

const jsEventTargetGetEventListenersCount = $newCppFunction<(emitter: EventTarget, type: string | symbol) => number | undefined>(
  "JSEventTarget.cpp",
  "jsEventTargetGetEventListenersCount",
  2,
);

function listenerCount(emitter: EventEmitter | EventTarget, type: string | symbol): number {
  if (typeof (emitter as EventEmitter).listenerCount === "function") {
    // Handle cases where listenerCount might be called on the prototype itself
    if (emitter === EventEmitter.prototype) {
      return 0; // Or handle appropriately, maybe throw? Node seems inconsistent here.
    }
    return (emitter as EventEmitter).listenerCount(type);
  }

  // EventTarget
  if (types.isEventTarget(emitter)) {
    const evt_count = jsEventTargetGetEventListenersCount(emitter as EventTarget, type);
    if (evt_count !== undefined) return evt_count;
  }

  // EventEmitter's with no `.listenerCount` or other objects
  return listenerCountSlow(emitter as unknown as EventEmitterPrivate, type);
}
Object.defineProperty(listenerCount, "name", { value: "listenerCount" });

function listenerCountSlow(emitter: EventEmitterPrivate, type: string | symbol): number {
  const events = emitter?._events; // Use optional chaining
  if (events === undefined) return 0;
  const evlistener = events[type];
  if (evlistener !== undefined) {
    // Node.js treats a single function listener as having length 1 implicitly in some contexts,
    // but _events stores it directly. The array check handles both cases.
    return Array.isArray(evlistener) ? evlistener.length : 1;
  }
  return 0;
}

// Update flags type to accept EventListenerOptions for removeEventListener
function eventTargetAgnosticRemoveListener(
  emitter: any,
  name: string | symbol,
  listener: (...args: any[]) => any,
  flags?: boolean | EventListenerOptions | undefined, // Use EventListenerOptions for remove
) {
  if (typeof emitter.removeListener === "function") {
    // EventEmitter uses removeListener(name, listener)
    emitter.removeListener(name, listener);
  } else if (typeof emitter.removeEventListener === "function") {
    // EventTarget uses removeEventListener(name, listener, optionsOrCapture)
    emitter.removeEventListener(name, listener, flags);
  } else {
    throw $ERR_INVALID_ARG_TYPE("emitter", "EventEmitter or EventTarget", emitter);
  }
}

// Update flags type to accept AddEventListenerOptions for addEventListener
function eventTargetAgnosticAddListener(
  emitter: any,
  name: string | symbol,
  listener: (...args: any[]) => any,
  flags?: boolean | AddEventListenerOptions | undefined, // Use AddEventListenerOptions for add
) {
  if (typeof emitter.on === "function") {
    // EventEmitter uses on(name, listener) or once(name, listener)
    if (typeof flags === "object" && flags?.once) {
      emitter.once(name, listener);
    } else {
      emitter.on(name, listener);
    }
  } else if (typeof emitter.addEventListener === "function") {
    // EventTarget uses addEventListener(name, listener, optionsOrCapture)
    emitter.addEventListener(name, listener, flags);
  } else {
    throw $ERR_INVALID_ARG_TYPE("emitter", "EventEmitter or EventTarget", emitter);
  }
}

// Use the full type directly instead of an alias
let RealAsyncResource: typeof import("node:async_hooks").AsyncResource | null = null;
let async_hooks_module: typeof import("node:async_hooks") | null = null; // Cache the module

function getMaxListeners(emitterOrTarget: EventEmitter | EventTarget): number {
  if (typeof (emitterOrTarget as EventEmitter)?.getMaxListeners === "function") {
    // We use _getMaxListeners here to handle the default value correctly.
    return _getMaxListeners(emitterOrTarget as unknown as EventEmitterPrivate);
  } else if (types.isEventTarget(emitterOrTarget)) {
    // Use ??= for default assignment
    (emitterOrTarget as any)[kMaxEventTargetListeners] ??= defaultMaxListeners;
    return (emitterOrTarget as any)[kMaxEventTargetListeners];
  }
  throw $ERR_INVALID_ARG_TYPE("emitter", ["EventEmitter", "EventTarget"], emitterOrTarget);
}
Object.defineProperty(getMaxListeners, "name", { value: "getMaxListeners" });

// Copy-pasta from Node.js source code - fixed __proto__ usage
function addAbortListener(signal: AbortSignal, listener: () => void): { [Symbol.dispose](): void } {
  if (signal === undefined) {
    throw $ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  }

  validateAbortSignal(signal, "signal");
  if (typeof listener !== "function") {
    throw $ERR_INVALID_ARG_TYPE("listener", "function", listener);
  }

  let removeEventListener: (() => void) | undefined;
  if (signal.aborted) {
    queueMicrotask(() => listener());
  } else {
    // Pass options object without __proto__
    const options = { once: true };
    signal.addEventListener("abort", listener, options);
    removeEventListener = () => {
      // Pass undefined for options during removal, as 'once' is handled by the listener itself
      // and EventListenerOptions doesn't include 'once'.
      signal.removeEventListener("abort", listener, undefined);
    };
  }
  // Create object without __proto__
  return Object.assign(Object.create(null), {
    [Symbol.dispose]() {
      removeEventListener?.();
    },
  });
}

interface EventEmitterAsyncResourceOptions extends EventEmitterOptions {
  triggerAsyncId?: number;
  name?: string;
  requireManualDestroy?: boolean;
}

// Fix AsyncResource usage
class EventEmitterAsyncResource extends EventEmitter {
  triggerAsyncId: number;
  asyncResource: import("node:async_hooks").AsyncResource; // Use the imported type directly

  constructor(options?: EventEmitterAsyncResourceOptions) {
    // Lazy load AsyncResource correctly
    if (!RealAsyncResource) {
      // Cache the required module
      if (!async_hooks_module) {
        // Cast to any first to bypass strict type checking during assignment
        async_hooks_module = require("node:async_hooks") as any as typeof import("node:async_hooks");
      }
      // Check if module was loaded successfully before accessing properties
      if (async_hooks_module) {
        // Assign the class constructor itself from the loaded module
        RealAsyncResource = async_hooks_module.AsyncResource;
      }
      if (!RealAsyncResource) {
        // This check might be redundant if require throws/returns null on failure,
        // but keep for robustness.
        throw new Error("AsyncResource could not be loaded from node:async_hooks");
      }
    }
    var {
      captureRejections = false,
      triggerAsyncId,
      name = (new.target || EventEmitterAsyncResource).name, // Use || for robustness
      requireManualDestroy,
    } = options || {};
    // Pass captureRejections to the super constructor
    super({ captureRejections });
    this.triggerAsyncId = triggerAsyncId ?? 0; // Use default if undefined

    // Use the correctly loaded constructor
    // Add type assertion to satisfy TS that RealAsyncResource is constructible here
    this.asyncResource = new (RealAsyncResource as any)(name, { triggerAsyncId, requireManualDestroy });
  }

  // Override emit to run in async scope
  emit(type: string | symbol, ...args: any[]): boolean {
    // Ensure asyncResource exists before calling methods on it
    // Use super.emit which correctly refers to the parent class's emit
    // The specific emit method (capturing or not) is determined by the constructor logic.
    return this.asyncResource.runInAsyncScope(() => super.emit(type, ...args));
  }

  emitDestroy() {
    // Ensure asyncResource exists before calling methods on it
    this.asyncResource.emitDestroy();
  }
}

// Define static properties on the class itself
Object.defineProperties(EventEmitter, {
  captureRejections: {
    get() {
      // Access prototype property
      return (EventEmitter.prototype as any)[kCapture];
    },
    set(value) {
      validateBoolean(value, "EventEmitter.captureRejections");
      // Set prototype property
      (EventEmitter.prototype as any)[kCapture] = value;
    },
    enumerable: true,
    configurable: true, // Allow redefinition if needed
  },
  // defaultMaxListeners is handled via static property and module variable
  // kMaxEventTargetListeners and kMaxEventTargetListenersWarned are already static properties
});

// Assign static methods/properties from the original object structure
Object.assign(EventEmitter, {
  once,
  on,
  getEventListeners,
  getMaxListeners,
  setMaxListeners,
  EventEmitter, // Export the class itself
  usingDomains: false, // Keep Node.js compatibility property
  captureRejectionSymbol,
  // Cast to any to resolve TS2322 - this might be necessary if the internal fix isn't enough
  // or if the target type `typeof import("node:events")` has stricter requirements.
  EventEmitterAsyncResource: EventEmitterAsyncResource as any,
  // errorMonitor is already a static property
  addAbortListener,
  // init: EventEmitter, // Not standard Node.js export
  listenerCount,
});

// Ensure the default export is correctly typed for module consumers
// Cast to any to resolve TS2322 - this might be necessary if the internal fix isn't enough
// or if the target type `typeof import("node:events")` has stricter requirements.
export default EventEmitter as any as typeof import("node:events");

// Add missing type declarations if needed
declare global {
  // Redeclare Function interface properties if necessary, or ensure they are globally available
  interface Function {
    listener?: (...args: any[]) => any; // Use more specific type if possible
  }
  interface Array<T> {
    warned?: boolean;
  }

  // EventTarget modifications are handled by the global declarations at the top
}