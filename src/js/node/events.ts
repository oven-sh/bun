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
const { addAbortListener } = require("internal/abort_listener");
const shared = require("internal/shared");
const { resistStopPropagation } = shared;

const types = require("node:util/types");
let inspect: ((value: unknown, opts?: object) => string) | undefined;

const ArrayPrototypeUnshift = Array.prototype.unshift;
const ReflectOwnKeys = Reflect.ownKeys;

const kCapture: typeof shared.kCapture = shared.kCapture;
// Set when `_events` was preallocated (streams do this): removeListener then
// writes `undefined` instead of `delete`, keeping one shared JSC Structure
// so the (StructureID, name)-keyed megamorphic cache stays hot.
const kShapeMode: typeof shared.kShapeMode = shared.kShapeMode;
const kErrorMonitor = Symbol.for("events.errorMonitor");
const kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners");
const kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned");
const kWatermarkData = Symbol.for("nodejs.watermarkData");
const kRejection = Symbol.for("nodejs.rejection");
const kFirstEventParam = Symbol.for("nodejs.kFirstEventParam");
const captureRejectionSymbol = Symbol.for("nodejs.rejection");

let FixedQueue: typeof import("internal/fixed_queue").default.FixedQueue | undefined;
const kEmptyObject = Object.freeze(Object.create(null));

var defaultMaxListeners = 10;

interface MaxListenersExceededWarning extends Error {
  emitter?: unknown;
  type?: string | symbol;
  count?: number;
}

/** A list that has grown past the limit once carries `warned`, so that the warning is printed once. */
type ListenerList = $Node.Listener[] & { warned?: boolean };

/** An `EventEmitter` or an `EventTarget`: the static functions tell them apart by their methods. */
interface EmitterOrTarget {
  on?(type: $Node.EventName, listener: $Node.Listener): unknown;
  once?(type: $Node.EventName, listener: $Node.Listener): unknown;
  removeListener?(type: $Node.EventName, listener: $Node.Listener): unknown;
  listeners?(type: $Node.EventName): $Node.Listener[];
  listenerCount?(type: $Node.EventName): number;
  setMaxListeners?(n: number): unknown;
  getMaxListeners?(): number;
  _maxListeners?: number;
  pause?(): unknown;
  resume?(): unknown;
  addEventListener?(type: $Node.EventName, listener: $Node.Listener, options?: object): void;
  removeEventListener?(type: $Node.EventName, listener: $Node.Listener, options?: object): void;
  [kMaxEventTargetListeners]?: number;
  [kMaxEventTargetListenersWarned]?: boolean;
}

interface OnceOptions {
  signal?: AbortSignal;
}

interface OnOptions {
  signal?: AbortSignal;
  close?: $Node.EventName[];
  highWaterMark?: number;
  highWatermark?: number;
  lowWaterMark?: number;
  lowWatermark?: number;
  [kFirstEventParam]?: boolean;
}

interface ListenerFlags {
  once?: boolean;
}

interface PendingNext {
  resolve(result: IteratorResult<unknown, undefined>): void;
  reject(error: unknown): void;
}

declare global {
  /** The instances of node's classes that are written as constructor functions, and their constructors. */
  namespace $Node {
    type EventName = string | symbol;

    interface Listener {
      (...args: any[]): unknown;
      /** On the wrapper that `once()` stores: the function that was given to it. */
      listener?: Listener;
    }

    /** One listener is stored bare, several in an array that is never changed in place. */
    type Events = Record<EventName, Listener | Listener[] | undefined>;

    interface EventEmitterOptions {
      __proto__?: null;
      captureRejections?: boolean;
    }

    interface EventEmitter extends EventEmitterPrototype {
      /** Missing on an object that has the prototype and never ran the constructor. */
      _events?: Events;
      _maxListeners?: number;
      [kShapeMode]?: boolean;
      [kRejection]?(error: unknown, type: EventName, ...args: unknown[]): void;
    }

    /** What `EventEmitter.prototype` itself holds: the methods and two defaults, and no other field of an instance. */
    interface EventEmitterPrototype {
      _eventsCount: number;
      [kCapture]: boolean;
      setMaxListeners(n: number): this;
      getMaxListeners(): number;
      emit(type: EventName, ...args: unknown[]): boolean;
      addListener(type: EventName, listener: Listener): this;
      on(type: EventName, listener: Listener): this;
      prependListener(type: EventName, listener: Listener): this;
      once(type: EventName, listener: Listener): this;
      prependOnceListener(type: EventName, listener: Listener): this;
      removeListener(type: EventName, listener: Listener): this;
      off(type: EventName, listener: Listener): this;
      removeAllListeners(type?: EventName): this;
      listeners(type: EventName): Listener[];
      rawListeners(type: EventName): Listener[];
      listenerCount(type: EventName, listener?: Listener): number;
      eventNames(): EventName[];
    }

    interface EventEmitterConstructor {
      new (options?: EventEmitterOptions): EventEmitter;
      (this: EventEmitter, options?: EventEmitterOptions): void;
      prototype: any;
      EventEmitter: EventEmitterConstructor;
      init: EventEmitterConstructor;
      EventEmitterAsyncResource: typeof EventEmitterAsyncResource;
      once: typeof once;
      on: typeof on;
      getEventListeners: typeof getEventListeners;
      getMaxListeners: typeof getMaxListeners;
      setMaxListeners: typeof setMaxListeners;
      listenerCount: typeof listenerCount;
      addAbortListener: typeof addAbortListener;
      usingDomains: boolean;
      captureRejections: boolean;
      defaultMaxListeners: number;
      /** The same symbol as `kRejection`, and for the type checker the same key. */
      readonly captureRejectionSymbol: typeof kRejection;
      readonly errorMonitor: typeof kErrorMonitor;
      readonly kMaxEventTargetListeners: typeof kMaxEventTargetListeners;
      readonly kMaxEventTargetListenersWarned: typeof kMaxEventTargetListenersWarned;
    }
  }
}

// EventEmitter must be a standard function because some old code will do weird tricks like `EventEmitter.$apply(this)`.
function EventEmitter(this: $Node.EventEmitter, opts?: $Node.EventEmitterOptions) {
  if (!IS_COMPILED_AHEAD_OF_TIME) {
    if (this._events === undefined || this._events === (this as any).__proto__._events) {
      this._events = Object.create(null);
      this._eventsCount = 0;
      this[kShapeMode] = false;
    } else {
      // Preallocated `_events` (streams).
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
    return;
  }
  if ($isProxyObject(this)) {
    ("unlikely");
    return initializeProxyReceiver(this, opts);
  }
  const events = this._events;
  const hasNoEvents = events === undefined || events === Object.getPrototypeOf(this)._events;
  const hasNoMaxListeners = this._maxListeners == null;
  const capturesRejections = opts?.captureRejections;
  if (hasNoMaxListeners && !capturesRejections && !EventEmitterPrototype[kCapture]) {
    if (hasNoEvents) {
      this._events = Object.create(null);
      this._eventsCount = 0;
      this[kShapeMode] = false;
      this._maxListeners = undefined;
      this[kCapture] = false;
    } else {
      // Preallocated `_events` (streams).
      this[kShapeMode] = true;
      this._maxListeners = undefined;
      this[kCapture] = false;
    }
    return;
  }

  if (hasNoEvents) {
    this._events = Object.create(null);
    this._eventsCount = 0;
    this[kShapeMode] = false;
  } else {
    this[kShapeMode] = true;
  }

  if (hasNoMaxListeners) this._maxListeners = undefined;
  if (capturesRejections) {
    ("unlikely");
    // TODO: make validator functions return the validated value instead of validating and then coercing an extra time
    validateBoolean(opts!.captureRejections, "options.captureRejections");
    this[kCapture] = !!opts!.captureRejections;
    storeEmitWithRejectionCapture(this);
  } else {
    const capture = EventEmitterPrototype[kCapture];
    this[kCapture] = capture;
    if (capture) {
      ("unlikely");
      storeEmitWithRejectionCapture(this);
    }
  }
}

function initializeProxyReceiver(emitter: any, opts?: $Node.EventEmitterOptions) {
  if (emitter._events === undefined || emitter._events === emitter.__proto__._events) {
    emitter._events = Object.create(null);
    emitter._eventsCount = 0;
    emitter[kShapeMode] = false;
  } else {
    emitter[kShapeMode] = true;
  }

  emitter._maxListeners ??= undefined;
  if (opts?.captureRejections) {
    validateBoolean(opts.captureRejections, "options.captureRejections");
    emitter[kCapture] = !!opts.captureRejections;
    emitter.emit = emitWithRejectionCapture;
  } else {
    emitter[kCapture] = EventEmitterPrototype[kCapture];
    const capture = EventEmitterPrototype[kCapture];
    emitter[kCapture] = capture;
    if (capture) {
      emitter.emit = emitWithRejectionCapture;
    }
  }
}
Object.defineProperty(EventEmitter, "name", { value: "EventEmitter", configurable: true });
const EventEmitterPrototype = (EventEmitter.prototype = {} as $Node.EventEmitterPrototype);

EventEmitterPrototype.setMaxListeners = function setMaxListeners(this: $Node.EventEmitter, n: number) {
  validateNumber(n, "setMaxListeners", 0);
  this._maxListeners = n;
  return this;
};
Object.defineProperty(EventEmitterPrototype.setMaxListeners, "name", { value: "setMaxListeners" });

EventEmitterPrototype.constructor = EventEmitter;

EventEmitterPrototype.getMaxListeners = function getMaxListeners(this: $Node.EventEmitter) {
  return _getMaxListeners(this);
};
Object.defineProperty(EventEmitterPrototype.getMaxListeners, "name", { value: "getMaxListeners" });

function emitError(emitter: $Node.EventEmitter, args: unknown[]) {
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

  let er: unknown;
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
function applyHandlers(handlers: $Node.Listener | $Node.Listener[], emitter: $Node.EventEmitter, args: unknown[]) {
  if (typeof handlers === "function") {
    handlers.$apply(emitter, args);
    return;
  }
  for (let i = 0, { length } = handlers; i < length; i++) {
    handlers[i].$apply(emitter, args);
  }
}

function addCatch(emitter: $Node.EventEmitter, promise: Promise<unknown>, type: $Node.EventName, args: unknown[]) {
  promise.then(undefined, function (err) {
    // The callback is called with nextTick to avoid a follow-up rejection from this promise.
    process.nextTick(emitUnhandledRejectionOrErr, emitter, err, type, args);
  });
}

function emitUnhandledRejectionOrErr(
  emitter: $Node.EventEmitter,
  err: unknown,
  type: $Node.EventName,
  args: unknown[],
) {
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

const emit = function emit(this: $Node.EventEmitter, type: $Node.EventName, ...args: unknown[]) {
  $debug(`${this.constructor?.name || "EventEmitter"}.emit`, type);

  if (type === "error") {
    ("unlikely");
    return emitError(this, args);
  }
  const { _events: events } = this;
  if (events === undefined) return false;
  const handler = events[type];
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
  // Compiled ahead of time, the loop is a function of its own, so that what is left is small enough to go where it is called.
  // In `bun run` that is one more call for every event with several listeners, a sixth more in the interpreter.
  if (IS_COMPILED_AHEAD_OF_TIME) return emitToEach(this, handler, handler.length, args);
  // No defensive clone: stored arrays are never mutated in place (mutators
  // install a copy), so this list stays stable for the whole loop even if a
  // listener adds/removes listeners.
  for (let i = 0, length = handler.length; i < length; i++) {
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

// The loop of emit() once more, for an executable that was compiled ahead of time. It takes the place of emit() in a stack trace, under its name.
const emitToEach = function emit(
  emitter: $Node.EventEmitter,
  listeners: $Node.Listener[],
  length: number,
  args: unknown[],
): boolean {
  for (let i = 0; i < length; i += 1) {
    const listener = listeners[i];
    switch (args.length) {
      case 0:
        listener.$call(emitter);
        break;
      case 1:
        listener.$call(emitter, args[0]);
        break;
      case 2:
        listener.$call(emitter, args[0], args[1]);
        break;
      case 3:
        listener.$call(emitter, args[0], args[1], args[2]);
        break;
      default:
        listener.$apply(emitter, args);
        break;
    }
  }
  return true;
};
EventEmitterPrototype.emit = emit;

const emitWithRejectionCapture = function emit(this: $Node.EventEmitter, type: $Node.EventName, ...args: unknown[]) {
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

// Only an emitter that captures rejections has an own `emit`. Compiled ahead of time, a store that names the property makes room for it in
// every emitter, and every call of `emit` asks whether it is there.
const propertiesOfCapturingEmitter = { emit: emitWithRejectionCapture };
function storeEmitWithRejectionCapture(emitter: $Node.EventEmitter) {
  if (IS_COMPILED_AHEAD_OF_TIME) {
    Object.assign(emitter, propertiesOfCapturingEmitter);
  } else {
    emitter.emit = emitWithRejectionCapture;
  }
}

function _addListener(target: $Node.EventEmitter, type: $Node.EventName, fn: $Node.Listener, prepend: boolean) {
  checkListener(fn);
  var events = target._events;
  if (!events) {
    events = target._events = Object.create(null) as $Node.Events;
    target._eventsCount = 0;
  } else if (events.newListener) {
    ("unlikely");
    target.emit("newListener", type, fn.listener ?? fn);
    // A newListener handler can replace `_events` (e.g. a once wrapper's
    // removeListener dropping the count to 0 installs a fresh object).
    events = target._events!;
  }
  var existing = events[type];
  if (existing === undefined) {
    // A single listener is stored bare, like node, so this allocates nothing.
    events[type] = fn;
    target._eventsCount++;
    return;
  }
  var handlers: $Node.Listener[];
  if (typeof existing === "function") {
    handlers = events[type] = prepend ? [fn, existing] : [existing, fn];
  } else {
    handlers = events[type] = copyWithInserted(existing, fn, prepend);
  }
  var m = _getMaxListeners(target);
  if (m > 0 && handlers.length > m && !(handlers as ListenerList).warned) {
    ("unlikely");
    overflowWarning(target, type, handlers);
  }
}

const addListener = function addListener(this: $Node.EventEmitter, type: $Node.EventName, fn: $Node.Listener) {
  _addListener(this, type, fn, false);
  return this;
};
EventEmitterPrototype.addListener = addListener;

EventEmitterPrototype.on = addListener;

EventEmitterPrototype.prependListener = function prependListener(
  this: $Node.EventEmitter,
  type: $Node.EventName,
  fn: $Node.Listener,
) {
  _addListener(this, type, fn, true);
  return this;
};

// Copy-on-write: emit iterates stored arrays with no clone, so new listeners
// land in a fresh array; `warned` carries over so the leak warning fires once.
// An inline loop beats concat/slice here ~10x (host-call boundary).
function copyWithInserted(list: $Node.Listener[], fn: $Node.Listener, prepend: boolean) {
  const n = list.length;
  const copy = $newArrayWithSize<$Node.Listener>(n + 1);
  // Two straight copies, not a per-element ternary (measured ~25% slower).
  if (prepend) {
    copy[0] = fn;
    for (let i = 0; i < n; i++) copy[i + 1] = list[i];
  } else {
    for (let i = 0; i < n; i++) copy[i] = list[i];
    copy[n] = fn;
  }
  if ((list as ListenerList).warned) (copy as ListenerList).warned = true;
  return copy;
}

function overflowWarning(emitter: $Node.EventEmitter, type: $Node.EventName, handlers: $Node.Listener[]) {
  if (!inspect) inspect = require("internal/util/inspect").inspect;
  (handlers as ListenerList).warned = true;
  const warn: MaxListenersExceededWarning = new Error(
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
function _onceWrap(
  target: $Node.EventEmitter | undefined,
  type: $Node.EventName,
  listener: $Node.Listener | undefined,
) {
  let fired = false;
  // Named `onceWrapper` so inspect/rawListeners() output tracks node's.
  const wrapped = function onceWrapper() {
    if (!fired) {
      fired = true;
      // Drop closure refs so anything that retains the fired wrapper (a cached
      // rawListeners() result, the COW array emit() is iterating) does not
      // retain the emitter. `wrapped.listener` stays: node asserts it survives.
      const t = target!;
      const l = listener!;
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

const onceMethod = function once(this: $Node.EventEmitter, type: $Node.EventName, fn: $Node.Listener) {
  checkListener(fn);
  this.on(type, _onceWrap(this, type, fn));
  return this;
};
EventEmitterPrototype.once = onceMethod;
Object.defineProperty(EventEmitterPrototype.once, "name", { value: "once" });

EventEmitterPrototype.prependOnceListener = function prependOnceListener(
  this: $Node.EventEmitter,
  type: $Node.EventName,
  fn: $Node.Listener,
) {
  checkListener(fn);
  this.prependListener(type, _onceWrap(this, type, fn));
  return this;
};

const removeListener = function removeListener(
  this: $Node.EventEmitter,
  type: $Node.EventName,
  listener: $Node.Listener,
) {
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
  if (n === 2) {
    events[type] = list[1 - position];
  } else {
    const copy = $newArrayWithSize<$Node.Listener>(n - 1);
    for (let i = 0; i < position; i++) copy[i] = list[i];
    for (let i = position + 1; i < n; i++) copy[i - 1] = list[i];
    if ((list as ListenerList).warned) (copy as ListenerList).warned = true;
    events[type] = copy;
  }

  if (events.removeListener !== undefined) this.emit("removeListener", type, listener.listener ?? listener);

  return this;
};
EventEmitterPrototype.removeListener = removeListener;

EventEmitterPrototype.off = removeListener;

const removeAllListeners = function removeAllListeners(this: $Node.EventEmitter, type?: $Node.EventName) {
  const events = this._events;
  if (events === undefined) return this;

  // Not listening for removeListener, no need to emit
  if (events.removeListener === undefined) {
    if (arguments.length === 0) {
      this._events = Object.create(null);
      this._eventsCount = 0;
    } else if (events[type!] !== undefined) {
      if (--this._eventsCount === 0) this._events = Object.create(null);
      else delete events[type!];
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

  const listeners = events[type!];
  if (typeof listeners === "function") {
    this.removeListener(type!, listeners);
  } else if (listeners !== undefined) {
    // LIFO order. `listeners` is our own snapshot; each removeListener call
    // installs a fresh array (or bare fn / nothing), so it stays intact here.
    for (let i = listeners.length - 1; i >= 0; i--) this.removeListener(type!, listeners[i]);
  }
  return this;
};
EventEmitterPrototype.removeAllListeners = removeAllListeners;

EventEmitterPrototype.listeners = function listeners(this: $Node.EventEmitter, type: $Node.EventName) {
  var { _events: events } = this;
  if (!events) return [];
  var handlers = events[type];
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers.listener ?? handlers];
  return handlers.map(x => x.listener ?? x);
};

EventEmitterPrototype.rawListeners = function rawListeners(this: $Node.EventEmitter, type: $Node.EventName) {
  var { _events } = this;
  if (!_events) return [];
  var handlers = _events[type];
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers];
  return handlers.slice();
};

const listenerCountMethod = function listenerCount(
  this: $Node.EventEmitter,
  type: $Node.EventName,
  method?: $Node.Listener,
) {
  var handlers = this._events?.[type];
  if (handlers === undefined) return 0;
  if (typeof handlers === "function") {
    if (method != null) return handlers === method || handlers.listener === method ? 1 : 0;
    return 1;
  }
  if (method != null) {
    var length = 0;
    for (let i = 0; i < handlers.length; i++) {
      const handler = handlers[i];
      if (handler === method || handler.listener === method) {
        length++;
      }
    }
    return length;
  }
  return handlers.length;
};
EventEmitterPrototype.listenerCount = listenerCountMethod;
Object.defineProperty(EventEmitterPrototype.listenerCount, "name", { value: "listenerCount" });

// The methods as they are written here, for the built-in modules that ask whether a method of an emitter is still the one of this module.
shared.originals.eventEmitter = {
  emit,
  storeEmitWithRejectionCapture,
  addListener,
  once: onceMethod,
  removeListener,
  removeAllListeners,
  listenerCount: listenerCountMethod,
};

EventEmitterPrototype.eventNames = function eventNames(this: $Node.EventEmitter) {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events!) : [];
};

EventEmitterPrototype[kCapture] = false;
// Prototype default, like node: the shape-mode constructor branch (a
// preallocated _events object, i.e. every stream) skips the own-property
// init, so without this the count is undefined and every ++/-- yields NaN.
EventEmitterPrototype._eventsCount = 0;

// `async` so the validation/already-aborted `throw`s below surface as a
// rejected promise instead of a synchronous throw — matches Node, whose
// `once` is also an async function (`once.constructor.name === "AsyncFunction"`).
async function once(emitter: EmitterOrTarget, type: $Node.EventName, options: OnceOptions = kEmptyObject) {
  validateObject(options, "options");
  var signal = options?.signal;
  validateAbortSignal(signal, "options.signal");
  if (signal?.aborted) {
    throw $makeAbortError(undefined, { cause: signal?.reason });
  }
  const promise = $newPromise<unknown[]>();
  const errorListener = (err: unknown) => {
    emitter.removeListener!(type, resolver);
    if (signal != null) {
      eventTargetAgnosticRemoveListener(signal, "abort", abortListener!);
    }
    $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, err);
  };
  const resolver = (...args: unknown[]) => {
    if (typeof emitter.removeListener === "function") {
      emitter.removeListener("error", errorListener);
    }
    if (signal != null) {
      eventTargetAgnosticRemoveListener(signal, "abort", abortListener!);
    }
    $resolvePromiseWithFirstResolvingFunctionCallCheck(promise, args);
  };
  let opts;
  if (typeof emitter.on === "function") {
    emitter.once!(type, resolver);
  } else {
    opts = resistStopPropagation({ __proto__: null, once: true });
    eventTargetAgnosticAddListener(emitter, type, resolver, opts);
  }
  if (type !== "error" && typeof emitter.once === "function") {
    // EventTarget does not have `error` event semantics like Node
    // EventEmitters, we listen to `error` events only on EventEmitters.
    emitter.once("error", errorListener);
  }
  let abortListener: (() => void) | undefined;
  if (signal != null) {
    abortListener = function abortListener() {
      eventTargetAgnosticRemoveListener(emitter, type, resolver);
      eventTargetAgnosticRemoveListener(emitter, "error", errorListener);
      $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, $makeAbortError(undefined, { cause: signal?.reason }));
    };
    eventTargetAgnosticAddListener(
      signal,
      "abort",
      abortListener,
      opts ?? resistStopPropagation({ __proto__: null, once: true }),
    );
  }

  return promise;
}
Object.defineProperty(once, "name", { value: "once" });

const AsyncIteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(async function* () {}).prototype);
function createIterResult(value: unknown, done: boolean) {
  return { value, done } as IteratorResult<unknown, undefined>;
}
function on(emitter: EmitterOrTarget, event: $Node.EventName, options: OnOptions = kEmptyObject) {
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
  const unconsumedEvents = new FixedQueue<unknown>();
  const unconsumedPromises = new FixedQueue<PendingNext>();
  let paused = false;
  let error: unknown = null;
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
            emitter.resume!(); // Can not be finished yet
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
        return new Promise<IteratorResult<unknown, undefined>>(function (resolve, reject) {
          unconsumedPromises.push({ resolve, reject });
        });
      },

      return() {
        return closeHandler();
      },

      throw(err: unknown) {
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
      : function (...args: unknown[]) {
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

  function eventHandler(value: unknown) {
    if (unconsumedPromises.isEmpty()) {
      size++;
      if (!paused && size > highWatermark) {
        paused = true;
        emitter.pause!();
      }
      unconsumedEvents.push(value);
    } else unconsumedPromises.shift()!.resolve(createIterResult(value, false));
  }

  function errorHandler(err: unknown) {
    if (unconsumedPromises.isEmpty()) error = err;
    else unconsumedPromises.shift()!.reject(err);

    closeHandler();
  }

  function closeHandler() {
    abortListenerDisposable?.[Symbol.dispose]();
    removeAll();
    finished = true;
    paused = false;
    const doneResult = createIterResult(undefined, true);
    while (!unconsumedPromises.isEmpty()) {
      unconsumedPromises.shift()!.resolve(doneResult);
    }

    return Promise.$resolve(doneResult);
  }
}
Object.defineProperty(on, "name", { value: "on" });

function listenersController() {
  const listeners: [
    emitter: EmitterOrTarget,
    event: $Node.EventName,
    handler: $Node.Listener,
    flags?: ListenerFlags,
  ][] = [];

  return {
    addEventListener(emitter: EmitterOrTarget, event: $Node.EventName, handler: $Node.Listener, flags?: ListenerFlags) {
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

const getEventListenersForEventTarget: (target: unknown, type: unknown) => $Node.Listener[] = $newCppFunction(
  "JSEventTargetNode.cpp",
  "jsFunctionNodeEventsGetEventListeners",
  1,
);

function getEventListeners(emitter: EmitterOrTarget, type: $Node.EventName) {
  if ($isCallable(emitter?.listeners)) {
    return emitter.listeners(type);
  }

  return getEventListenersForEventTarget(emitter, type);
}

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/events.js#L315-L339
function setMaxListeners(n = defaultMaxListeners, ...eventTargets: EmitterOrTarget[]) {
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

const jsEventTargetGetEventListenersCount: (target: unknown, type: unknown) => number | undefined = $newCppFunction(
  "JSEventTarget.cpp",
  "jsEventTargetGetEventListenersCount",
  2,
);

function listenerCount(emitter: EmitterOrTarget, type: $Node.EventName) {
  if ($isCallable(emitter.listenerCount)) {
    return emitter.listenerCount(type);
  }

  // EventTarget
  const evt_count = jsEventTargetGetEventListenersCount(emitter, type);
  if (evt_count !== undefined) return evt_count;

  throw $ERR_INVALID_ARG_TYPE("emitter", ["EventEmitter", "EventTarget"], emitter);
}
Object.defineProperty(listenerCount, "name", { value: "listenerCount" });

function eventTargetAgnosticRemoveListener(
  emitter: EmitterOrTarget,
  name: $Node.EventName,
  listener: $Node.Listener,
  flags?: ListenerFlags,
) {
  if (typeof emitter.removeListener === "function") {
    emitter.removeListener(name, listener);
  } else if (typeof emitter.removeEventListener === "function") {
    emitter.removeEventListener(name, listener, flags);
  } else {
    throw $ERR_INVALID_ARG_TYPE("emitter", "EventEmitter", emitter);
  }
}

function eventTargetAgnosticAddListener(
  emitter: EmitterOrTarget,
  name: $Node.EventName,
  listener: $Node.Listener,
  flags?: ListenerFlags,
) {
  if (typeof emitter.on === "function") {
    if (flags?.once) {
      emitter.once!(name, listener);
    } else {
      emitter.on(name, listener);
    }
  } else if (typeof emitter.addEventListener === "function") {
    emitter.addEventListener(name, listener, flags);
  } else {
    throw $ERR_INVALID_ARG_TYPE("emitter", "EventEmitter", emitter);
  }
}

function checkListener(listener: $Node.Listener) {
  if (typeof listener !== "function") validateFunction(listener, "listener");
}

function _getMaxListeners(emitter: { _maxListeners?: number }) {
  return emitter?._maxListeners ?? defaultMaxListeners;
}

type AsyncResourceClass = typeof import("./async_hooks").default.AsyncResource;
let AsyncResource: AsyncResourceClass | null = null;

function getMaxListeners(emitterOrTarget: EmitterOrTarget) {
  if (typeof emitterOrTarget?.getMaxListeners === "function") {
    return _getMaxListeners(emitterOrTarget);
  } else if (types.isEventTarget(emitterOrTarget)) {
    emitterOrTarget[kMaxEventTargetListeners] ??= defaultMaxListeners;
    return emitterOrTarget[kMaxEventTargetListeners];
  }
  throw $ERR_INVALID_ARG_TYPE("emitter", ["EventEmitter", "EventTarget"], emitterOrTarget);
}
Object.defineProperty(getMaxListeners, "name", { value: "getMaxListeners" });

interface EventEmitterAsyncResourceOptions extends $Node.EventEmitterOptions {
  name?: string;
  triggerAsyncId?: number;
  requireManualDestroy?: boolean;
}

type AsyncResourceInstance = InstanceType<AsyncResourceClass>;
interface ReferencingAsyncResource extends AsyncResourceInstance {
  readonly eventEmitter: EventEmitterAsyncResource;
}

let EventEmitterReferencingAsyncResource:
  | (new (
      ee: EventEmitterAsyncResource,
      type: string,
      options?: EventEmitterAsyncResourceOptions,
    ) => ReferencingAsyncResource)
  | undefined;
function lazyLoadAsyncResource() {
  if (!AsyncResource) {
    AsyncResource = require("node:async_hooks").AsyncResource;
    EventEmitterReferencingAsyncResource = class EventEmitterReferencingAsyncResource extends AsyncResource {
      #eventEmitter: EventEmitterAsyncResource;

      constructor(ee: EventEmitterAsyncResource, type: string, options?: EventEmitterAsyncResourceOptions) {
        super(type, options);
        this.#eventEmitter = ee;
      }

      get eventEmitter() {
        return this.#eventEmitter;
      }
    };
  }
}

class EventEmitterAsyncResource extends (EventEmitter as $Node.EventEmitterConstructor) {
  #asyncResource: ReferencingAsyncResource;

  constructor(options?: string | EventEmitterAsyncResourceOptions) {
    lazyLoadAsyncResource();
    let name: string;
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
    this.#asyncResource = new EventEmitterReferencingAsyncResource!(this, name, options);
    // EventEmitter's constructor stamps `this.emit = emitWithRejectionCapture`
    // as an OWN property when captureRejections is on, which would shadow the
    // prototype's runInAsyncScope-wrapped emit below. Remove it so listeners
    // still run in the resource's async scope; the prototype emit re-checks
    // this[kCapture] on every call, so rejection capture is preserved. delete
    // is a no-op when the property is absent, so no own-property check needed.
    delete (this as any).emit;
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

  emit(event: $Node.EventName, ...args: unknown[]): boolean {
    const asyncResource = this.#asyncResource;
    // The base EventEmitter picks its emit variant by stamping an own property;
    // that own property is deleted in the constructor above, so pick per-call
    // from this[kCapture]. The default branch reads super.emit at call time
    // (Node routes through super.emit) so a userland monkeypatch of
    // EventEmitter.prototype.emit is observed like it is for plain emitters.
    if (this[kCapture]) {
      ("unlikely");
      ArrayPrototypeUnshift.$call(args, emitWithRejectionCapture, this, event);
    } else {
      ArrayPrototypeUnshift.$call(args, super.emit, this, event);
    }
    return asyncResource.runInAsyncScope.$apply(
      asyncResource,
      args as Parameters<typeof asyncResource.runInAsyncScope>,
    ) as boolean;
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
    set(value: boolean) {
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
    set: (arg: number) => {
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

// Node: `Object.getPrototypeOf(process) instanceof EventEmitter` holds.
// Link the native process prototype under this module's EventEmitter; the
// native methods stay earlier in the chain and keep winning lookups.
try {
  const processPrototype = Object.getPrototypeOf(process);
  if (
    processPrototype !== null &&
    processPrototype !== Object.prototype &&
    !(processPrototype instanceof EventEmitter)
  ) {
    Object.setPrototypeOf(processPrototype, EventEmitter.prototype);
  }
} catch {
  // If the prototype is not relinkable, process simply keeps its native
  // chain; everything else about this module still works.
}

export default EventEmitter as $Node.EventEmitterConstructor;
