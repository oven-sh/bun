// The methods of node:events' EventEmitter.prototype and their helpers. NodeEventEmitterPrototype.cpp puts them on
// the prototype and behind the $nodeEvents names. No module is evaluated unless a method throws or warns.

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

$overriddenName = "setMaxListeners";
$constructor;
export function setMaxListeners(this: any, n) {
  if (typeof n !== "number" || !(n >= 0)) require("internal/validators").validateNumber(n, "setMaxListeners", 0);
  this._maxListeners = n;
  return this;
}

$overriddenName = "getMaxListeners";
$constructor;
export function getMaxListeners(this: any) {
  return this?._maxListeners ?? $nodeEventsDefaultMaxListeners;
}

$overriddenName = "emitError";
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
$overriddenName = "applyHandlers";
export function applyHandlers(handlers, emitter, args) {
  if (typeof handlers === "function") {
    handlers.$apply(emitter, args);
    return;
  }
  for (let i = 0, { length } = handlers; i < length; i++) {
    handlers[i].$apply(emitter, args);
  }
}

$overriddenName = "overflowWarning";
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

$overriddenName = "removeAllListeners";
$constructor;
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

$overriddenName = "listeners";
$constructor;
export function listeners(this: any, type) {
  var { _events: events } = this;
  if (!events) return [];
  var handlers = events[type];
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers.listener ?? handlers];
  return handlers.map(x => x.listener ?? x);
}

$overriddenName = "rawListeners";
$constructor;
export function rawListeners(this: any, type) {
  var { _events } = this;
  if (!_events) return [];
  var handlers = _events[type];
  if (!handlers) return [];
  if (typeof handlers === "function") return [handlers];
  return handlers.slice();
}

$overriddenName = "listenerCount";
$constructor;
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

$overriddenName = "eventNames";
$constructor;
export function eventNames(this: any) {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
}
