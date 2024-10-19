"use strict";
const primordials = require("internal/primordials");
const {
  ArrayFrom,
  ArrayPrototypeReduce,
  Boolean,
  Error,
  FunctionPrototypeCall,
  NumberIsInteger,
  ObjectAssign,
  ObjectDefineProperties,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectGetOwnPropertyDescriptor,
  SafeFinalizationRegistry,
  SafeMap,
  SafeWeakMap,
  SafeWeakRef,
  SafeWeakSet,
  String,
  Symbol,
  SymbolFor,
  SymbolToStringTag,
} = primordials;

const {
  validateAbortSignal,
  validateObject,
  validateString,
  validateInternalField,
  kValidateObjectAllowObjects,
} = require("./validators");

const kEnumerableProperty = Object.create(null);
kEnumerableProperty.enumerable = true;
const kEmptyObject = ObjectFreeze({ __proto__: null });

const { customInspectSymbol } = require("../node/util");
const { inspect } = require("../node/util");
const webidl = require("./webidl");

const kIsEventTarget = SymbolFor("nodejs.event_target");
const kIsNodeEventTarget = Symbol("kIsNodeEventTarget");

const EventEmitter = require("../node/events");
const { kMaxEventTargetListeners, kMaxEventTargetListenersWarned } = EventEmitter;

const kEvents = Symbol("kEvents");
const kIsBeingDispatched = Symbol("kIsBeingDispatched");
const kStop = Symbol("kStop");
const kTarget = Symbol("kTarget");
const kHandlers = Symbol("kHandlers");
const kWeakHandler = Symbol("kWeak");
const kResistStopPropagation = Symbol("kResistStopPropagation");

const kHybridDispatch = SymbolFor("nodejs.internal.kHybridDispatch");
const kRemoveWeakListenerHelper = Symbol("kRemoveWeakListenerHelper");
const kCreateEvent = Symbol("kCreateEvent");
const kNewListener = Symbol("kNewListener");
const kRemoveListener = Symbol("kRemoveListener");
const kIsNodeStyleListener = Symbol("kIsNodeStyleListener");
const kTrustEvent = Symbol("kTrustEvent");

const { now } = require("../node/perf_hooks");

const kType = Symbol("type");
const kDetail = Symbol("detail");

const isTrustedSet = new SafeWeakSet();
const isTrusted = ObjectGetOwnPropertyDescriptor(
  {
    get isTrusted() {
      return isTrustedSet.has(this);
    },
  },
  "isTrusted",
).get;

const isTrustedDescriptor = {
  __proto__: null,
  configurable: false,
  enumerable: true,
  get: isTrusted,
};

function isEvent(value) {
  return typeof value?.[kType] === "string";
}

function Event(type, options = undefined) {
  if (!(this instanceof Event)) {
    throw new TypeError("Class constructors cannot be invoked without 'new'");
  }
  if (arguments.length === 0) throw $ERR_MISSING_ARGS("type");
  if (options != null) validateObject(options, "options");
  this._bubbles = !!options?.bubbles;
  this._cancelable = !!options?.cancelable;
  this._composed = !!options?.composed;

  this[kType] = `${type}`;
  if (options?.[kTrustEvent]) {
    isTrustedSet.add(this);
  }

  this[kTarget] = null;
  this[kIsBeingDispatched] = false;
  this._defaultPrevented = false;
  this._timestamp = now();
  this._propagationStopped = false;
}

Event.prototype = {};

Event.prototype.initEvent = function (type, bubbles = false, cancelable = false) {
  if (arguments.length === 0) throw $ERR_MISSING_ARGS("type");

  if (this[kIsBeingDispatched]) {
    return;
  }
  this[kType] = `${type}`;
  this._bubbles = !!bubbles;
  this._cancelable = !!cancelable;
};

Event.prototype[customInspectSymbol] = function (depth, options) {
  if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
  const name = this.constructor.name;
  if (depth < 0) return name;

  const opts = ObjectAssign({}, options, {
    depth: NumberIsInteger(options.depth) ? options.depth - 1 : options.depth,
  });

  return `${name} ${inspect(
    {
      type: this[kType],
      defaultPrevented: this._defaultPrevented,
      cancelable: this._cancelable,
      timeStamp: this._timestamp,
    },
    opts,
  )}`;
};

Event.prototype.stopImmediatePropagation = function () {
  if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
  // Spec mentions "stopImmediatePropagation should set both "stop propagation"
  // and "stop immediate propagation" flags"
  // cf: from https://dom.spec.whatwg.org/#dom-event-stopimmediatepropagation
  this.stopPropagation();
  this[kStop] = true;
};

Event.prototype.preventDefault = function () {
  if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
  this._defaultPrevented = true;
};

ObjectDefineProperties(Event.prototype, {
  target: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this[kTarget];
    },
    enumerable: true,
  },
  currentTarget: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this[kIsBeingDispatched] ? this[kTarget] : null;
    },
    enumerable: true,
  },
  srcElement: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this[kTarget];
    },
    enumerable: true,
  },
  type: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this[kType];
    },
    enumerable: true,
  },
  cancelable: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this._cancelable;
    },
    enumerable: true,
  },
  defaultPrevented: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this._cancelable && this._defaultPrevented;
    },
    enumerable: true,
  },
  timeStamp: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this._timestamp;
    },
    enumerable: true,
  },
  // The following are non-op and unused properties/methods from Web API Event.
  // These are not supported in Node.js and are provided purely for
  // API completeness.
  composedPath: {
    value: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this[kIsBeingDispatched] ? [this[kTarget]] : [];
    },
    enumerable: true,
  },
  returnValue: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return !this._cancelable || !this._defaultPrevented;
    },
    enumerable: true,
  },
  bubbles: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this._bubbles;
    },
    enumerable: true,
  },
  composed: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this._composed;
    },
    enumerable: true,
  },
  eventPhase: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this[kIsBeingDispatched] ? Event.AT_TARGET : Event.NONE;
    },
    enumerable: true,
  },
  cancelBubble: {
    get: function () {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      return this._propagationStopped;
    },
    set: function (value) {
      if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
      if (value) {
        this._propagationStopped = true;
      }
    },
    enumerable: true,
  },
});

Event.prototype.stopPropagation = function () {
  if (!isEvent(this)) throw $ERR_INVALID_THIS("Event");
  this._propagationStopped = true;
};

// Define Symbol.toStringTag
ObjectDefineProperty(Event.prototype, SymbolToStringTag, {
  value: "Event",
  writable: false,
  enumerable: false,
  configurable: true,
});

// Attach isTrusted
ObjectDefineProperty(Event.prototype, "isTrusted", isTrustedDescriptor);

// Define static properties
ObjectDefineProperties(Event, {
  NONE: { value: 0, writable: false, configurable: false, enumerable: true },
  CAPTURING_PHASE: { value: 1, writable: false, configurable: false, enumerable: true },
  AT_TARGET: { value: 2, writable: false, configurable: false, enumerable: true },
  BUBBLING_PHASE: { value: 3, writable: false, configurable: false, enumerable: true },
});

// CustomEvent
function isCustomEvent(value) {
  return isEvent(value) && value?.[kDetail] !== undefined;
}

function CustomEvent(type, options = kEmptyObject) {
  if (!(this instanceof CustomEvent)) {
    throw new TypeError("Class constructors cannot be invoked without 'new'");
  }
  if (arguments.length === 0) throw $ERR_MISSING_ARGS("type");
  Event.$call(this, type, options);
  this[kDetail] = options?.detail ?? null;
}

// Inherit from Event
CustomEvent.prototype = Object.create(Event.prototype);
CustomEvent.prototype.constructor = CustomEvent;

// Define getters
ObjectDefineProperties(CustomEvent.prototype, {
  detail: {
    get: function () {
      if (!isCustomEvent(this)) throw $ERR_INVALID_THIS("CustomEvent");
      return this[kDetail];
    },
    enumerable: true,
  },
});

// Define Symbol.toStringTag
ObjectDefineProperty(CustomEvent.prototype, SymbolToStringTag, {
  value: "CustomEvent",
  writable: false,
  enumerable: false,
  configurable: true,
});

// Weak listener cleanup
// This has to be lazy for snapshots to work
let weakListenersState = null;
// The resource needs to retain the callback so that it doesn't
// get garbage collected now that it's weak.
let objectToWeakListenerMap = null;
function weakListeners() {
  weakListenersState ??= new SafeFinalizationRegistry(({ eventTarget, listener, eventType }) =>
    eventTarget.deref()?.[kRemoveWeakListenerHelper](eventType, listener),
  );
  objectToWeakListenerMap ??= new SafeWeakMap();
  return { registry: weakListenersState, map: objectToWeakListenerMap };
}

const kFlagOnce = 1 << 0;
const kFlagCapture = 1 << 1;
const kFlagPassive = 1 << 2;
const kFlagNodeStyle = 1 << 3;
const kFlagWeak = 1 << 4;
const kFlagRemoved = 1 << 5;
const kFlagResistStopPropagation = 1 << 6;

// Listener
function Listener(
  eventTarget,
  eventType,
  previous,
  listener,
  once,
  capture,
  passive,
  isNodeStyleListener,
  weak,
  resistStopPropagation,
) {
  this.next = undefined;
  if (previous !== undefined) previous.next = this;
  this.previous = previous;
  this.listener = listener;

  let flags = 0b0;
  if (once) flags |= kFlagOnce;
  if (capture) flags |= kFlagCapture;
  if (passive) flags |= kFlagPassive;
  if (isNodeStyleListener) flags |= kFlagNodeStyle;
  if (weak) flags |= kFlagWeak;
  if (resistStopPropagation) flags |= kFlagResistStopPropagation;
  this.flags = flags;

  this.removed = false;

  if (this.weak) {
    this.callback = new SafeWeakRef(listener);
    weakListeners().registry.register(
      listener,
      {
        __proto__: null,
        // Weak ref so the listener won't hold the eventTarget alive
        eventTarget: new SafeWeakRef(eventTarget),
        listener: this,
        eventType,
      },
      this,
    );
    // Make the retainer retain the listener in a WeakMap
    weakListeners().map.set(weak, listener);
    this.listener = this.callback;
  } else if (typeof listener === "function") {
    this.callback = listener;
    this.listener = listener;
  } else {
    this.callback = async (...args) => {
      if (listener.handleEvent) await Reflect.$apply(listener.handleEvent, listener, args);
    };
    this.listener = listener;
  }
}

Listener.prototype = {};

ObjectDefineProperties(Listener.prototype, {
  once: {
    get: function () {
      return Boolean(this.flags & kFlagOnce);
    },
    enumerable: true,
  },
  capture: {
    get: function () {
      return Boolean(this.flags & kFlagCapture);
    },
    enumerable: true,
  },
  passive: {
    get: function () {
      return Boolean(this.flags & kFlagPassive);
    },
    enumerable: true,
  },
  isNodeStyleListener: {
    get: function () {
      return Boolean(this.flags & kFlagNodeStyle);
    },
    enumerable: true,
  },
  weak: {
    get: function () {
      return Boolean(this.flags & kFlagWeak);
    },
    enumerable: true,
  },
  resistStopPropagation: {
    get: function () {
      return Boolean(this.flags & kFlagResistStopPropagation);
    },
    enumerable: true,
  },
  removed: {
    get: function () {
      return Boolean(this.flags & kFlagRemoved);
    },
    set: function (value) {
      if (value) this.flags |= kFlagRemoved;
      else this.flags &= ~kFlagRemoved;
    },
    enumerable: true,
  },
});

Listener.prototype.same = function (listener, capture) {
  const myListener = this.weak ? this.listener.deref() : this.listener;
  return myListener === listener && this.capture === capture;
};

Listener.prototype.remove = function () {
  if (this.previous !== undefined) this.previous.next = this.next;
  if (this.next !== undefined) this.next.previous = this.previous;
  this.removed = true;
  if (this.weak) weakListeners().registry.unregister(this);
};

// EventTarget
function initEventTarget(self) {
  self[kEvents] = new SafeMap();
  self[kMaxEventTargetListeners] = EventEmitter.defaultMaxListeners;
  self[kMaxEventTargetListenersWarned] = false;
  self[kHandlers] = new SafeMap();
}

function EventTarget() {
  if (!(this instanceof EventTarget)) {
    throw new TypeError("Class constructors cannot be invoked without 'new'");
  }
  initEventTarget(this);
}

EventTarget[kIsEventTarget] = true;

EventTarget.prototype = {};

EventTarget.prototype[kNewListener] = function (size, type, listener, once, capture, passive, weak) {
  if (
    this[kMaxEventTargetListeners] > 0 &&
    size > this[kMaxEventTargetListeners] &&
    !this[kMaxEventTargetListenersWarned]
  ) {
    this[kMaxEventTargetListenersWarned] = true;
    // No error code for this since it is a Warning
    // eslint-disable-next-line no-restricted-syntax
    const w = new Error(
      "Possible EventTarget memory leak detected. " +
        `${size} ${type} listeners ` +
        `added to ${inspect(this, { depth: -1 })}. MaxListeners is ${this[kMaxEventTargetListeners]}. Use ` +
        "events.setMaxListeners() to increase limit",
    );
    w.name = "MaxListenersExceededWarning";
    w.target = this;
    w.type = type;
    w.count = size;
    process.emitWarning(w);
  }
};

EventTarget.prototype[kRemoveListener] = function (size, type, listener, capture) {};

EventTarget.prototype.addEventListener = function (type, listener, options = kEmptyObject) {
  if (!isEventTarget(this)) throw $ERR_INVALID_THIS("EventTarget");
  if (arguments.length < 2) throw $ERR_MISSING_ARGS("type", "listener");

  // We validateOptions before the validateListener check because the spec
  // requires us to hit getters.
  const { once, capture, passive, signal, isNodeStyleListener, weak, resistStopPropagation } =
    validateEventListenerOptions(options);

  validateAbortSignal(signal, "options.signal");

  if (!validateEventListener(listener)) {
    // The DOM silently allows passing undefined as a second argument
    // No error code for this since it is a Warning
    // eslint-disable-next-line no-restricted-syntax
    const w = new Error(`addEventListener called with ${listener}` + " which has no effect.");
    w.name = "AddEventListenerArgumentTypeWarning";
    w.target = this;
    w.type = type;
    process.emitWarning(w);
    return;
  }
  type = webidl.converters.DOMString(type);

  if (signal) {
    if (signal.aborted) {
      return;
    }
    // TODO(benjamingr) make this weak somehow? ideally the signal would
    // not prevent the event target from GC.
    signal.addEventListener(
      "abort",
      () => {
        this.removeEventListener(type, listener, options);
      },
      { __proto__: null, once: true, [kWeakHandler]: this, [kResistStopPropagation]: true },
    );
  }

  let root = this[kEvents].get(type);

  if (root === undefined) {
    root = { size: 1, next: undefined, resistStopPropagation: Boolean(resistStopPropagation) };
    // This is the first handler in our linked list.
    new Listener(this, type, root, listener, once, capture, passive, isNodeStyleListener, weak, resistStopPropagation);
    this[kNewListener](root.size, type, listener, once, capture, passive, weak);
    this[kEvents].set(type, root);
    return;
  }

  let handler = root.next;
  let previous = root;

  // We have to walk the linked list to see if we have a match
  while (handler !== undefined && !handler.same(listener, capture)) {
    previous = handler;
    handler = handler.next;
  }

  if (handler !== undefined) {
    // Duplicate! Ignore
    return;
  }

  new Listener(
    this,
    type,
    previous,
    listener,
    once,
    capture,
    passive,
    isNodeStyleListener,
    weak,
    resistStopPropagation,
  );
  root.size++;
  root.resistStopPropagation ||= Boolean(resistStopPropagation);
  this[kNewListener](root.size, type, listener, once, capture, passive, weak);
};

EventTarget.prototype.removeEventListener = function (type, listener, options = kEmptyObject) {
  if (!isEventTarget(this)) throw $ERR_INVALID_THIS("EventTarget");
  if (arguments.length < 2) throw $ERR_MISSING_ARGS("Expected type and listener arguments");
  if (!validateEventListener(listener)) return;

  type = webidl.converters.DOMString(type);
  const capture = options?.capture === true;

  const root = this[kEvents].get(type);
  if (root === undefined || root.next === undefined) return;

  let handler = root.next;
  while (handler !== undefined) {
    if (handler.same(listener, capture)) {
      handler.remove();
      root.size--;
      if (root.size === 0) this[kEvents].delete(type);
      this[kRemoveListener](root.size, type, listener, capture);
      break;
    }
    handler = handler.next;
  }
};

EventTarget.prototype[kRemoveWeakListenerHelper] = function (type, listener) {
  const root = this[kEvents].get(type);
  if (root === undefined || root.next === undefined) return;

  const capture = listener.capture === true;

  let handler = root.next;
  while (handler !== undefined) {
    if (handler === listener) {
      handler.remove();
      root.size--;
      if (root.size === 0) this[kEvents].delete(type);
      // Undefined is passed as the listener as the listener was GCed
      this[kRemoveListener](root.size, type, undefined, capture);
      break;
    }
    handler = handler.next;
  }
};

EventTarget.prototype.dispatchEvent = function (event) {
  if (!isEventTarget(this)) throw $ERR_INVALID_THIS("EventTarget");
  if (arguments.length < 1) throw $ERR_MISSING_ARGS("event");

  if (!(event instanceof Event)) throw $ERR_INVALID_ARG_TYPE("event", "Event", event);

  if (event[kIsBeingDispatched]) throw $ERR_EVENT_RECURSION("event.type");

  this[kHybridDispatch](event, event.type, event);

  return event.defaultPrevented !== true;
};

EventTarget.prototype[kHybridDispatch] = function (nodeValue, type, event) {
  const createEvent = () => {
    if (event === undefined) {
      event = this[kCreateEvent](nodeValue, type);
      event[kTarget] = this;
      event[kIsBeingDispatched] = true;
    }
    return event;
  };
  if (event !== undefined) {
    event[kTarget] = this;
    event[kIsBeingDispatched] = true;
  }

  const root = this[kEvents].get(type);
  if (root === undefined || root.next === undefined) {
    if (event !== undefined) event[kIsBeingDispatched] = false;
    return true;
  }

  let handler = root.next;
  let next;

  const iterationCondition = () => {
    if (handler === undefined) {
      return false;
    }
    return root.resistStopPropagation || handler.passive || event?.[kStop] !== true;
  };
  while (iterationCondition()) {
    // Cache the next item in case this iteration removes the current one
    next = handler.next;

    if (handler.removed || (event?.[kStop] === true && !handler.resistStopPropagation)) {
      // Deal with the case an event is removed while event handlers are
      // Being processed (removeEventListener called from a listener)
      // And the case of event.stopImmediatePropagation() being called
      // For events not flagged as resistStopPropagation
      handler = next;
      continue;
    }
    if (handler.once) {
      handler.remove();
      root.size--;
      const { listener, capture } = handler;
      this[kRemoveListener](root.size, type, listener, capture);
    }

    try {
      let arg;
      if (handler.isNodeStyleListener) {
        arg = nodeValue;
      } else {
        arg = createEvent();
      }
      const callback = handler.weak ? handler.callback.deref() : handler.callback;
      let result;
      if (callback) {
        result = callback.$call(this, arg);
        if (!handler.isNodeStyleListener) {
          arg[kIsBeingDispatched] = false;
        }
      }
      if (result !== undefined && result !== null) addCatch(result);
    } catch (err) {
      emitUncaughtException(err);
    }

    handler = next;
  }

  if (event !== undefined) event[kIsBeingDispatched] = false;
};

EventTarget.prototype[kCreateEvent] = function (nodeValue, type) {
  return new CustomEvent(type, { detail: nodeValue });
};

EventTarget.prototype[customInspectSymbol] = function (depth, options) {
  if (!isEventTarget(this)) throw $ERR_INVALID_THIS("EventTarget");
  const name = this.constructor.name;
  if (depth < 0) return name;

  const opts = ObjectAssign({}, options, {
    depth: NumberIsInteger(options.depth) ? options.depth - 1 : options.depth,
  });

  return `${name} ${inspect({}, opts)}`;
};

// Define Symbol.toStringTag
ObjectDefineProperty(EventTarget.prototype, SymbolToStringTag, {
  value: "EventTarget",
  writable: false,
  enumerable: false,
  configurable: true,
});

ObjectDefineProperties(EventTarget.prototype, {
  addEventListener: kEnumerableProperty,
  removeEventListener: kEnumerableProperty,
  dispatchEvent: kEnumerableProperty,
});

// NodeEventTarget
function initNodeEventTarget(self) {
  initEventTarget(self);
}

function NodeEventTarget() {
  if (!(this instanceof NodeEventTarget)) {
    throw new TypeError("Class constructors cannot be invoked without 'new'");
  }
  EventTarget.$call(this);
  initNodeEventTarget(this);
}

NodeEventTarget.prototype = Object.create(EventTarget.prototype);
NodeEventTarget.prototype.constructor = NodeEventTarget;
NodeEventTarget[kIsNodeEventTarget] = true;
NodeEventTarget.defaultMaxListeners = 10;

NodeEventTarget.prototype.setMaxListeners = function (n) {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  EventEmitter.setMaxListeners(n, this);
};

NodeEventTarget.prototype.getMaxListeners = function () {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  return this[kMaxEventTargetListeners];
};

NodeEventTarget.prototype.eventNames = function () {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  return ArrayFrom(this[kEvents].keys());
};

NodeEventTarget.prototype.listenerCount = function (type) {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  const root = this[kEvents].get(String(type));
  return root !== undefined ? root.size : 0;
};

NodeEventTarget.prototype.off = function (type, listener, options) {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  this.removeEventListener(type, listener, options);
  return this;
};

NodeEventTarget.prototype.removeListener = function (type, listener, options) {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  this.removeEventListener(type, listener, options);
  return this;
};

NodeEventTarget.prototype.on = function (type, listener) {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  this.addEventListener(type, listener, { [kIsNodeStyleListener]: true });
  return this;
};

NodeEventTarget.prototype.addListener = function (type, listener) {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  this.addEventListener(type, listener, { [kIsNodeStyleListener]: true });
  return this;
};

NodeEventTarget.prototype.emit = function (type, arg) {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  validateString(type, "type");
  const hadListeners = this.listenerCount(type) > 0;
  this[kHybridDispatch](arg, type);
  return hadListeners;
};

NodeEventTarget.prototype.once = function (type, listener) {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  this.addEventListener(type, listener, { once: true, [kIsNodeStyleListener]: true });
  return this;
};

NodeEventTarget.prototype.removeAllListeners = function (type) {
  if (!isNodeEventTarget(this)) throw $ERR_INVALID_THIS("NodeEventTarget");
  if (type !== undefined) {
    this[kEvents].delete(String(type));
  } else {
    this[kEvents].clear();
  }

  return this;
};

ObjectDefineProperties(NodeEventTarget.prototype, {
  setMaxListeners: kEnumerableProperty,
  getMaxListeners: kEnumerableProperty,
  eventNames: kEnumerableProperty,
  listenerCount: kEnumerableProperty,
  off: kEnumerableProperty,
  removeListener: kEnumerableProperty,
  on: kEnumerableProperty,
  addListener: kEnumerableProperty,
  once: kEnumerableProperty,
  emit: kEnumerableProperty,
  removeAllListeners: kEnumerableProperty,
});

// EventTarget API

function validateEventListener(listener) {
  if (typeof listener === "function" || typeof listener?.handleEvent === "function") {
    return true;
  }

  if (listener == null) return false;

  if (typeof listener === "object") {
    // Require `handleEvent` lazily.
    return true;
  }

  throw $ERR_INVALID_ARG_TYPE("listener", "EventListener", listener);
}

function validateEventListenerOptions(options) {
  if (typeof options === "boolean") return { capture: options };

  if (options === null) return kEmptyObject;
  validateObject(options, "options", kValidateObjectAllowObjects);
  return {
    once: Boolean(options.once),
    capture: Boolean(options.capture),
    passive: Boolean(options.passive),
    signal: options.signal,
    weak: options[kWeakHandler],
    resistStopPropagation: options[kResistStopPropagation] ?? false,
    isNodeStyleListener: Boolean(options[kIsNodeStyleListener]),
  };
}

// Test whether the argument is an event object. This is far from a fool-proof
// test, for example this input will result in a false positive:
// > isEventTarget({ constructor: EventTarget })
// It stands in its current implementation as a compromise.
// Ref: https://github.com/nodejs/node/pull/33661
function isEventTarget(obj) {
  return obj?.constructor?.[kIsEventTarget];
}

function isNodeEventTarget(obj) {
  return obj?.constructor?.[kIsNodeEventTarget];
}

function addCatch(promise) {
  const then = promise.then;
  if (typeof then === "function") {
    FunctionPrototypeCall(then, promise, undefined, function (err) {
      // The callback is called with nextTick to avoid a follow-up
      // rejection from this promise.
      emitUncaughtException(err);
    });
  }
}

function emitUncaughtException(err) {
  process.nextTick(() => {
    throw err;
  });
}

function makeEventHandler(handler) {
  // Event handlers are dispatched in the order they were first set
  // See https://github.com/nodejs/node/pull/35949#issuecomment-722496598
  function eventHandler(...args) {
    if (typeof eventHandler.handler !== "function") {
      return;
    }
    return Reflect.$apply(eventHandler.handler, this, args);
  }
  eventHandler.handler = handler;
  return eventHandler;
}

function defineEventHandler(emitter, name, event = name) {
  // 8.1.5.1 Event handlers - basically `on[eventName]` attributes
  const propName = `on${name}`;
  function get() {
    validateInternalField(this, kHandlers, "EventTarget");
    return this[kHandlers]?.get(event)?.handler ?? null;
  }
  ObjectDefineProperty(get, "name", {
    __proto__: null,
    value: `get ${propName}`,
  });

  function set(value) {
    validateInternalField(this, kHandlers, "EventTarget");
    let wrappedHandler = this[kHandlers]?.get(event);
    if (wrappedHandler) {
      if (typeof wrappedHandler.handler === "function") {
        this[kEvents].get(event).size--;
        const size = this[kEvents].get(event).size;
        this[kRemoveListener](size, event, wrappedHandler.handler, false);
      }
      wrappedHandler.handler = value;
      if (typeof wrappedHandler.handler === "function") {
        this[kEvents].get(event).size++;
        const size = this[kEvents].get(event).size;
        this[kNewListener](size, event, value, false, false, false, false);
      }
    } else {
      wrappedHandler = makeEventHandler(value);
      this.addEventListener(event, wrappedHandler);
    }
    this[kHandlers].set(event, wrappedHandler);
  }
  ObjectDefineProperty(set, "name", {
    __proto__: null,
    value: `set ${propName}`,
  });

  ObjectDefineProperty(emitter, propName, {
    __proto__: null,
    get,
    set,
    configurable: true,
    enumerable: true,
  });
}

export default {
  Event,
  CustomEvent,
  EventTarget,
  NodeEventTarget,
  defineEventHandler,
  initEventTarget,
  initNodeEventTarget,
  kCreateEvent,
  kNewListener,
  kTrustEvent,
  kRemoveListener,
  kEvents,
  kWeakHandler,
  kResistStopPropagation,
  isEventTarget,
};
