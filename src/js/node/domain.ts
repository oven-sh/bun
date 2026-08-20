// Import Events
let EventEmitter;

const ObjectDefineProperty = Object.defineProperty;
const ObjectDefineProperties = Object.defineProperties;
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;

// Export Domain
var domain: any = {};

// Tag `err` as thrown (best-effort: frozen / non-extensible / proxy-backed
// values cannot be decorated) and dispatch it on the already-exited domain.
function emitThrownError(d, err) {
  if (typeof err === "object" && err !== null) {
    try {
      ObjectDefineProperty(err, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: d,
        writable: true,
      });
      err.domainThrown = true;
    } catch {}
  }
  d.emit("error", err);
}

// Wrap `cb` so that when it runs, `d` is entered for the duration of the call
// and any synchronous throw is routed through the domain's 'error' event.
function bindCallbackToDomain(d, cb) {
  return function boundDomainCallback() {
    d.enter();
    let exited = false;
    try {
      return cb.$apply(this, arguments);
    } catch (err) {
      // Match node: the domain is exited before its 'error' handler runs, so
      // work scheduled inside the handler is not bound to the failed domain.
      exited = true;
      d.exit();
      emitThrownError(d, err);
    } finally {
      if (!exited) d.exit();
    }
  };
}

// Patch the global timer APIs once so that callbacks scheduled while a domain
// is active are bound to that domain at schedule time, matching node's
// implicit async binding for timers (https://github.com/oven-sh/bun/issues/30672).
let timersPatched = false;
function patchTimersOnce() {
  if (timersPatched) return;
  timersPatched = true;

  function wrapTimerApi(orig) {
    const wrapped = function (callback, ...rest) {
      const d = domain.active;
      if (d && $isCallable(callback)) {
        callback = bindCallbackToDomain(d, callback);
      }
      return orig(callback, ...rest);
    };
    // Preserve own properties of the original, notably
    // Symbol.for("nodejs.util.promisify.custom") so util.promisify(setTimeout)
    // keeps returning the timers/promises implementation.
    ObjectDefineProperties(wrapped, ObjectGetOwnPropertyDescriptors(orig));
    return wrapped;
  }

  globalThis.setTimeout = wrapTimerApi(globalThis.setTimeout);
  globalThis.setInterval = wrapTimerApi(globalThis.setInterval);
  globalThis.setImmediate = wrapTimerApi(globalThis.setImmediate);
}

domain.createDomain = domain.create = function () {
  if (!EventEmitter) {
    EventEmitter = require("node:events");
  }
  patchTimersOnce();
  var d = new EventEmitter();

  function emitError(e) {
    e ||= $ERR_UNHANDLED_ERROR();
    if (typeof e === "object") {
      // Best-effort: decoration failure on a frozen / non-extensible value
      // must not prevent the error from reaching the handler.
      try {
        e.domainEmitter = this;
        ObjectDefineProperty(e, "domain", {
          __proto__: null,
          configurable: true,
          enumerable: false,
          value: d,
          writable: true,
        });
        e.domainThrown = false;
      } catch {}
    }
    d.emit("error", e);
  }

  d.add = function (emitter) {
    emitter.on("error", emitError);
  };
  d.remove = function (emitter) {
    emitter.removeListener("error", emitError);
  };
  d.bind = function (fn) {
    return function () {
      var args = Array.prototype.slice.$call(arguments);
      try {
        fn.$apply(null, args);
      } catch (err) {
        emitError(err);
      }
    };
  };
  d.intercept = function (fn) {
    return function (err) {
      if (err) {
        emitError(err);
      } else {
        var args = Array.prototype.slice.$call(arguments, 1);
        try {
          fn.$apply(null, args);
        } catch (err) {
          emitError(err);
        }
      }
    };
  };
  d.run = function (fn, ...args) {
    this.enter();
    let exited = false;
    try {
      return fn.$apply(this, args);
    } catch (err) {
      // Match node: exit before dispatching 'error' (see bindCallbackToDomain).
      exited = true;
      this.exit();
      emitThrownError(d, err);
    } finally {
      if (!exited) this.exit();
    }
  };
  d.dispose = function () {
    this.removeAllListeners();
    return this;
  };
  d.enter = function () {
    stack.push(this);
    domain.active = process.domain = this;
    return this;
  };
  d.exit = function () {
    const index = stack.lastIndexOf(this);
    if (index === -1) return this;
    stack.splice(index, stack.length);
    domain.active = process.domain = stack.length ? stack[stack.length - 1] : null;
    return this;
  };
  return d;
};

// Domains entered via enter()/run() and not yet exited, innermost last.
// process.domain mirrors the top of the stack like in node so other modules
// can observe the currently active domain.
const stack: any[] = [];
domain._stack = stack;
domain.active = null;

// Match node: after `require('domain')`, `process.domain` exists (and is null)
// even if no domain has been entered yet.
if ((process as any).domain === undefined) (process as any).domain = null;

export default domain;
