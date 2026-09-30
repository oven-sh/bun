// The methods of node:events' EventEmitter.prototype and the functions that they call. NodeEventEmitterPrototype.cpp
// defines the methods on the prototype and the other functions under the `$nodeEvents` names. A method evaluates a
// module only when it throws or warns.

interface Listener extends Function {
  listener?: Function;
}

interface ListenerList extends Array<Listener> {
  warned?: boolean;
}

interface MaxListenersExceededWarning extends Error {
  emitter?: unknown;
  type?: string | symbol;
  count?: number;
}

export function setMaxListeners(this: any, n) {
  if (typeof n !== "number" || !(n >= 0)) require("internal/validators").validateNumber(n, "setMaxListeners", 0);
  this._maxListeners = n;
  return this;
}

export function getMaxListeners(this: any) {
  return this?._maxListeners ?? $nodeEventsDefaultMaxListeners;
}

export function emitError(emitter, args) {
  var { _events: events } = emitter;

  if (events !== undefined) {
    const errorMonitor = events[$nodeEventsKErrorMonitor];
    if (errorMonitor !== undefined) {
      $nodeEventsApplyHandlers(errorMonitor, emitter, args);
    }

    const handlers = events.error;
    if (handlers !== undefined) {
      $nodeEventsApplyHandlers(handlers, emitter, args);
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
    const inspect: (value: unknown, opts?: object) => string = require("internal/util/inspect").inspect;
    stringifiedEr = inspect(er);
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
export function applyHandlers(handlers, emitter, args) {
  if (typeof handlers === "function") {
    handlers.$apply(emitter, args);
    return;
  }
  for (let i = 0, { length } = handlers; i < length; i++) {
    handlers[i].$apply(emitter, args);
  }
}

// A builtin begins with "use strict", which a function with a rest parameter may not contain. So `emit` is the
// function that this one returns. src/js/node/events.ts calls it once.
export function createEmit() {
  return function emit(this: any, type, ...args) {
    if (type === "error") {
      return $nodeEventsEmitError(this, args);
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
}

$overriddenName = "_addListener";
export function internalAddListener(target, type, fn, prepend) {
  if (typeof fn !== "function") require("internal/validators").validateFunction(fn, "listener");
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
    handlers = events[type] = $nodeEventsCopyWithInserted(existing, fn, prepend);
  }
  var m = target?._maxListeners ?? $nodeEventsDefaultMaxListeners;
  if (m > 0 && handlers.length > m && !handlers.warned) {
    $nodeEventsOverflowWarning(target, type, handlers);
  }
}

export function addListener(this: any, type, fn) {
  $nodeEventsAddListener(this, type, fn, false);
  return this;
}

export function prependListener(this: any, type, fn) {
  $nodeEventsAddListener(this, type, fn, true);
  return this;
}

// Copy-on-write: emit iterates stored arrays with no clone, so new listeners
// land in a fresh array; `warned` carries over so the leak warning fires once.
// An inline loop beats concat/slice here ~10x (host-call boundary).
export function copyWithInserted(list, fn, prepend) {
  const n = list.length;
  const copy: ListenerList = $newArrayWithSize(n + 1);
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

export function overflowWarning(emitter, type, handlers) {
  const inspect: (value: unknown, opts?: object) => string = require("internal/util/inspect").inspect;
  handlers.warned = true;
  const warn: MaxListenersExceededWarning = new Error(
    `Possible EventEmitter memory leak detected. ${handlers.length} ${String(type)} listeners added to ${inspect(emitter, { depth: -1 })}. MaxListeners is ${emitter?._maxListeners ?? $nodeEventsDefaultMaxListeners}. Use emitter.setMaxListeners() to increase limit`,
  );
  warn.name = "MaxListenersExceededWarning";
  warn.emitter = emitter;
  warn.type = type;
  warn.count = handlers.length;
  process.emitWarning(warn);
}

// A closure over (target, type, listener, fired) rather than a state object
// plus onceWrapper.bind(state): one allocation instead of two per once().
$overriddenName = "_onceWrap";
export function internalOnceWrap(target, type, listener) {
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

export function once(this: any, type, fn) {
  if (typeof fn !== "function") require("internal/validators").validateFunction(fn, "listener");
  this.on(type, $nodeEventsOnceWrap(this, type, fn));
  return this;
}

export function prependOnceListener(this: any, type, fn) {
  if (typeof fn !== "function") require("internal/validators").validateFunction(fn, "listener");
  this.prependListener(type, $nodeEventsOnceWrap(this, type, fn));
  return this;
}

export function removeListener(this: any, type, listener) {
  if (typeof listener !== "function") require("internal/validators").validateFunction(listener, "listener");

  const events = this._events;
  if (events === undefined) return this;

  const list = events[type];
  if (list === undefined) return this;

  if (typeof list === "function") {
    // Bare single listener.
    if (list !== listener && list.listener !== listener) return this;
    this._eventsCount--;
    if (this[$nodeEventsKShapeMode]) {
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
  const copy: ListenerList = $newArrayWithSize(n - 1);
  for (let i = 0, j = 0; i < n; i++) {
    if (i !== position) copy[j++] = list[i];
  }
  if (list.warned) copy.warned = true;
  events[type] = copy.length === 1 ? copy[0] : copy;

  if (events.removeListener !== undefined) this.emit("removeListener", type, listener.listener ?? listener);

  return this;
}

export function removeAllListeners(this: any, type) {
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
    this[$nodeEventsKShapeMode] = false;
    return this;
  }

  // Emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (const key of $ownKeys(events)) {
      if (key === "removeListener") continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners("removeListener");
    this._events = Object.create(null);
    this._eventsCount = 0;
    this[$nodeEventsKShapeMode] = false;
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
}

export function listeners(this: any, type) {
  var { _events: events } = this;
  if (!events) return [];
  var handlers = events[type];
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers.listener ?? handlers];
  return handlers.map(x => x.listener ?? x);
}

export function rawListeners(this: any, type) {
  var { _events } = this;
  if (!_events) return [];
  var handlers = _events[type];
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers];
  return handlers.slice();
}

export function listenerCount(this: any, type, method) {
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
}

export function eventNames(this: any) {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
}
