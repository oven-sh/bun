// The `domain` module is pending-deprecation in Node.js and is implemented
// as a minimal compatibility layer in Bun.
//
// Key design points:
// - A stack of entered domains is maintained and exposed through the exported
//   `active` property and `process.domain`.
// - `d.enter()` / `d.exit()` push/pop on the stack.
// - `d.run(fn)` enters the domain, runs `fn`, then exits. Synchronous throws
//   from `fn` are routed through `emit('error', err)`.
// - Async callbacks scheduled via `setTimeout`/`setInterval`/`setImmediate`
//   inside a domain are bound to the active domain at schedule time, so
//   exceptions thrown from those callbacks are also routed to the domain.
// - `d.bind(fn)` / `d.intercept(fn)` wrap a function so the domain is entered
//   for the duration of the call and synchronous throws are emitted on it.

const ObjectDefineProperty = Object.defineProperty;

let EventEmitter;

// The stack of entered domains. Top of stack = currently-active domain.
const stack: any[] = [];

// Whether we've installed the timer shims.
let installed = false;

// Save the originals so the shims can delegate to them without going through
// the (possibly re-patched) global again.
let origSetTimeout;
let origSetInterval;
let origSetImmediate;

function currentDomain() {
  return stack.length === 0 ? null : stack[stack.length - 1];
}

function syncProcessDomain() {
  (process as any).domain = currentDomain();
}

// Decorate the thrown value with Node's documented `domain` / `domainThrown`
// properties. Must never throw — e.g. the thrown value may be frozen, sealed,
// a proxy with a trapping setter, or non-extensible. Any decoration failure is
// swallowed so that the original error still reaches `emit('error', …)`.
function decorateThrownError(e, d, thrown) {
  if ((typeof e === "object" && e !== null) || typeof e === "function") {
    try {
      ObjectDefineProperty(e, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: d,
        writable: true,
      });
      e.domainThrown = thrown;
    } catch {}
  }
}

// Wrap `cb` so that when it runs, the given `domain` is entered for the
// duration of the call and any synchronous throw is routed through the
// domain's `'error'` event.
function bindCallback(domain, cb) {
  return function boundDomainCallback() {
    domain.enter();
    let emitted = false;
    try {
      return cb.$apply(this, arguments);
    } catch (err) {
      emitted = true;
      domain._emitError(err);
    } finally {
      if (!emitted) domain.exit();
    }
  };
}

function installOnce() {
  if (installed) return;
  installed = true;

  (process as any).domain = null;

  origSetTimeout = globalThis.setTimeout;
  origSetInterval = globalThis.setInterval;
  origSetImmediate = globalThis.setImmediate;

  function wrapTimerApi(orig) {
    return function (callback, ...rest) {
      const d = currentDomain();
      if (d && $isCallable(callback)) {
        callback = bindCallback(d, callback);
      }
      return orig(callback, ...rest);
    };
  }

  globalThis.setTimeout = wrapTimerApi(origSetTimeout);
  globalThis.setInterval = wrapTimerApi(origSetInterval);
  globalThis.setImmediate = wrapTimerApi(origSetImmediate);

  // Intentionally NO `process.on('uncaughtException', …)` listener: in Bun,
  // registering one signals to the native uncaught-exception handler that the
  // error has been handled (see `Bun__handleUncaughtException`), which would
  // silently swallow every error thrown outside any domain once `domain` has
  // been required anywhere in the process. All schedule-time paths
  // (`bind`, `intercept`, `run`, and the timer wrappers above) already catch
  // and route errors themselves, so no fallback hook is needed.
}

var domain: any = {};

// Match Node: after `require('domain')`, `process.domain` exists (and is null)
// even if no domain has been created yet.
if ((process as any).domain === undefined) (process as any).domain = null;

domain.createDomain = domain.create = function () {
  if (!EventEmitter) {
    EventEmitter = require("node:events");
  }
  installOnce();

  const d = new EventEmitter();

  function emitError(e) {
    e ||= $ERR_UNHANDLED_ERROR();
    decorateThrownError(e, d, true);
    // Pop adjacent copies of this domain so that the error handler runs
    // outside the domain it belongs to (matches Node).
    while (currentDomain() === d) {
      d.exit();
    }
    d.emit("error", e);
  }
  d._emitError = emitError;

  // `d.add(emitter)`: errors emitted by `emitter` are routed to this domain.
  // Node tags the error with `domainEmitter = emitter` and `domainThrown = false`
  // on this path to distinguish emitted vs. thrown errors.
  const memberListeners = new WeakMap();
  d.add = function (emitter) {
    if (memberListeners.has(emitter)) return;
    const listener = function (e) {
      if ((typeof e === "object" && e !== null) || typeof e === "function") {
        try {
          e.domainEmitter = emitter;
        } catch {}
      }
      decorateThrownError(e, d, false);
      while (currentDomain() === d) d.exit();
      d.emit("error", e);
    };
    memberListeners.set(emitter, listener);
    emitter.on("error", listener);
    d.members.push(emitter);
  };
  d.remove = function (emitter) {
    const listener = memberListeners.get(emitter);
    if (listener) {
      emitter.removeListener("error", listener);
      memberListeners.delete(emitter);
    }
    const i = d.members.indexOf(emitter);
    if (i !== -1) d.members.splice(i, 1);
  };
  d.bind = function (fn) {
    return function () {
      d.enter();
      let emitted = false;
      try {
        return fn.$apply(this, arguments);
      } catch (err) {
        emitted = true;
        emitError(err);
      } finally {
        if (!emitted) d.exit();
      }
    };
  };
  d.intercept = function (fn) {
    return function (err) {
      if (err) {
        emitError(err);
        return;
      }
      const args = Array.prototype.slice.$call(arguments, 1);
      d.enter();
      let emitted = false;
      try {
        return fn.$apply(this, args);
      } catch (caught) {
        emitted = true;
        emitError(caught);
      } finally {
        if (!emitted) d.exit();
      }
    };
  };
  d.enter = function () {
    stack[stack.length] = this;
    syncProcessDomain();
    return this;
  };
  d.exit = function () {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i] === this) {
        stack.length = i;
        syncProcessDomain();
        break;
      }
    }
    return this;
  };
  d.run = function (fn) {
    this.enter();
    let emitted = false;
    try {
      const argCount = arguments.length;
      switch (argCount) {
        case 1:
          return fn.$call(this);
        case 2:
          return fn.$call(this, arguments[1]);
        case 3:
          return fn.$call(this, arguments[1], arguments[2]);
        default: {
          const args = Array.prototype.slice.$call(arguments, 1);
          return fn.$apply(this, args);
        }
      }
    } catch (err) {
      emitted = true;
      emitError(err);
    } finally {
      if (!emitted) this.exit();
    }
    return this;
  };
  d.dispose = function () {
    this.removeAllListeners();
    return this;
  };
  d.members = [];

  return d;
};

Object.defineProperty(domain, "active", {
  __proto__: null,
  enumerable: true,
  configurable: true,
  get() {
    return currentDomain();
  },
});

Object.defineProperty(domain, "_stack", {
  __proto__: null,
  enumerable: false,
  configurable: true,
  get() {
    return stack;
  },
});

export default domain;
