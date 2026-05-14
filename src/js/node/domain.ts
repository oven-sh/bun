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
// - When a domain is active and an uncaught exception fires, the domain's
//   `'error'` handler is invoked before Bun's default uncaught-exception path.

const ObjectDefineProperty = Object.defineProperty;

let EventEmitter;

// The stack of entered domains. Top of stack = currently-active domain.
const stack: any[] = [];

// Whether we've installed the timer shims / uncaughtException listener.
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

  // If an exception escapes to `uncaughtException` while a domain is active,
  // route it through the active domain. Prepend so we run before any
  // user-registered handler.
  process.prependListener("uncaughtException", err => {
    const d = currentDomain();
    if (d !== null) {
      d._emitError(err);
    }
  });
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
    if (typeof e === "object" && e !== null) {
      ObjectDefineProperty(e, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: d,
        writable: true,
      });
      e.domainThrown = true;
    }
    // Pop adjacent copies of this domain so that the error handler runs
    // outside the domain it belongs to (matches Node).
    while (currentDomain() === d) {
      d.exit();
    }
    d.emit("error", e);
  }
  d._emitError = emitError;

  d.add = function (emitter) {
    emitter.on("error", emitError);
  };
  d.remove = function (emitter) {
    emitter.removeListener("error", emitError);
  };
  d.bind = function (fn) {
    return function () {
      try {
        return fn.$apply(this, arguments);
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
        const args = Array.prototype.slice.$call(arguments, 1);
        try {
          fn.$apply(this, args);
        } catch (caught) {
          emitError(caught);
        }
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
