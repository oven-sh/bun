// Installs node's NodeEventTarget emitter surface on MessagePort. Lives in its
// own module so it runs on the first emitter-method access (via the MessagePort
// prototype bootstraps in src/js/builtins/MessagePort.ts) rather than only when
// node:worker_threads happens to be loaded.

const { SafeMap } = require("internal/primordials");

const emitterMethodNames = [
  "on",
  "off",
  "once",
  "emit",
  "addListener",
  "removeListener",
  "listenerCount",
  "eventNames",
  "removeAllListeners",
  "setMaxListeners",
  "getMaxListeners",
] as const;

function injectFakeEmitter(Class) {
  // Per-instance registry mapping each event to (user listener -> wrapper), so
  // listenerCount/eventNames/removeAllListeners work over EventTarget's opaque
  // internal map and off() can find the wrapper a given listener registered.
  // SafeMap: its prototype is a frozen, null-proto snapshot of Map.prototype, so
  // .get/.set/.size/.values()/iteration all bypass a user-replaced Map.prototype.
  // (It has no @get/@set private names, so the $-intrinsics don't apply to it.)
  // Keyed by a module-local symbol, not a WeakMap — WeakMap has neither defence.
  const kListenerRegistry = Symbol("listenerRegistry");
  function registryFor(target, create) {
    let map = target[kListenerRegistry];
    if (!map && create) target[kListenerRegistry] = map = new SafeMap();
    return map;
  }

  function messageEventHandler(event: MessageEvent) {
    return event.data;
  }

  function errorEventHandler(event: ErrorEvent) {
    return event.error;
  }

  function customEventHandler(event) {
    return event.detail;
  }

  function wrapped(run, listener) {
    return function (event) {
      return listener(run(event));
    };
  }

  function functionForEventType(event, listener) {
    switch (event) {
      case "error":
      case "messageerror": {
        return wrapped(errorEventHandler, listener);
      }

      case "message": {
        return wrapped(messageEventHandler, listener);
      }

      default: {
        return wrapped(customEventHandler, listener);
      }
    }
  }

  function EventClass(eventName) {
    if (eventName === "error" || eventName === "messageerror") {
      return ErrorEvent;
    }

    return MessageEvent;
  }

  // EventTarget dedupes on (type, callback), so in node the FIRST registration of
  // a listener wins outright -- including its once-ness -- and later adds of the
  // same function are no-ops. Keying wrappers per listener reproduces that.
  function register(target, event, listener, wrapper, options) {
    const map = registryFor(target, true)!;
    let byListener = map.get(event);
    if (!byListener) map.set(event, (byListener = new SafeMap()));
    if (byListener.has(listener)) return false;
    target.addEventListener(event, wrapper, options);
    byListener.set(listener, wrapper);
    return true;
  }

  function on(event, listener) {
    register(this, event, listener, functionForEventType(event, listener), undefined);
    return this;
  }

  function off(event, listener) {
    if (listener) {
      const byListener = registryFor(this, false)?.get(event);
      const wrapper = byListener?.get(listener) ?? listener;
      this.removeEventListener(event, wrapper);
      byListener?.delete(listener);
    } else {
      this.removeEventListener(event);
    }
    return this;
  }

  function once(event, listener) {
    const wrapper = functionForEventType(event, listener);
    const target = this;
    // EventTarget drops a {once:true} listener natively, without telling the
    // registry — so purge it here or listenerCount()/eventNames() keep counting
    // a listener that already fired.
    function onceWrapper(ev) {
      registryFor(target, false)?.get(event)?.delete(listener);
      return wrapper(ev);
    }
    register(this, event, listener, onceWrapper, { once: true });
    return this;
  }

  function emit(event, ...args) {
    switch (event) {
      case "error":
      case "messageerror":
      case "message":
        this.dispatchEvent(new (EventClass(event))(event, ...args));
        break;
      default:
        // Non-standard events surface as CustomEvent (detail = first arg) to
        // addEventListener and as the raw argument to .on(), matching node.
        this.dispatchEvent(new CustomEvent(event, { detail: args[0] }));
        break;
    }
    return this;
  }

  const kMaxListeners = Symbol("kMaxListeners");
  function setMaxListeners(n) {
    this[kMaxListeners] = n;
    return this;
  }
  function getMaxListeners() {
    return this[kMaxListeners] ?? 10;
  }
  function listenerCount(type) {
    return registryFor(this, false)?.get(type)?.size ?? 0;
  }
  function eventNames() {
    const map = registryFor(this, false);
    if (!map) return [];
    const out: string[] = [];
    for (const [k, v] of map) if (v.size > 0) out.push(k);
    return out;
  }
  function removeAllListeners(type) {
    const map = registryFor(this, false);
    if (!map) return this;
    const removeType = t => {
      const byListener = map.get(t);
      if (byListener) {
        for (const w of byListener.values()) this.removeEventListener(t, w);
        map.delete(t);
      }
    };
    if (arguments.length === 0) {
      // removeType only deletes `t`, and a Map iterator tolerates deleting the
      // entry it just yielded — so no snapshot copy is needed here.
      for (const t of map.keys()) removeType(t);
    } else {
      removeType(type);
    }
    return this;
  }

  // node inherits these from NodeEventTarget.prototype (a curated subset of
  // EventEmitter, not EventEmitter itself); use an intermediate prototype so
  // Object.getOwnPropertyNames(MessagePort.prototype) matches node.
  const proto = Class.prototype;
  const inherited = Object.create(Object.getPrototypeOf(proto));
  const emitterMethods: [string, Function][] = [
    ["on", on],
    ["off", off],
    ["once", once],
    ["emit", emit],
    ["addListener", on],
    ["removeListener", off],
    ["listenerCount", listenerCount],
    ["eventNames", eventNames],
    ["removeAllListeners", removeAllListeners],
    ["setMaxListeners", setMaxListeners],
    ["getMaxListeners", getMaxListeners],
  ];
  for (const [methodName, value] of emitterMethods) {
    Object.defineProperty(inherited, methodName, { value, writable: true, enumerable: false, configurable: true });
  }
  // Remove the bootstrap own-properties JSMessagePort.cpp put on the prototype
  // so subsequent lookups fall through to `inherited`.
  for (const methodName of emitterMethodNames) delete proto[methodName];
  Object.setPrototypeOf(proto, inherited);
}

injectFakeEmitter(globalThis.MessagePort);

export default {};
