// Hardcoded module "node:domain"
//
// Port of node's lib/domain.js. Node releases follow a domain across async
// boundaries with async_hooks: `init` pairs a new resource with process.domain,
// `before` and `after` enter and exit that domain around each callback. Bun
// has no before/after hooks, so the stack of entered domains lives in the
// async context instead (the store AsyncLocalStorage rides), the way node's
// main branch now does it too. Every callback that snapshots the async context
// (timers, process.nextTick, promise reactions, I/O callbacks) then runs with
// the stack it was created under.
//
// Errors reach `handleError` below through jsFunctionSetDomainErrorHandler
// (BunProcess.cpp). The uncaught-exception and unhandled-rejection paths call
// it with the async context of the throw (or rejection) still active and skip
// the 'uncaughtException' / 'unhandledRejection' listeners when it returns
// true, like node's domain-owned uncaughtExceptionCaptureCallback.

const EventEmitter = require("node:events");
const { AsyncLocalStorage } = require("node:async_hooks");

const setDomainErrorHandler = $newCppFunction("BunProcess.cpp", "jsFunctionSetDomainErrorHandler", 1);

const ObjectDefineProperty = Object.defineProperty;

// The domains entered and not yet exited, innermost last, or undefined when
// there is none. Never mutated in place: enter()/exit() install a new array so
// a callback that snapshotted the old context keeps its own stack.
const domainStack = new AsyncLocalStorage();

function currentStack(): Domain[] | undefined {
  return domainStack.getStore();
}

// Writes the [AsyncLocalStorage, value, ...] context array node/async_hooks.ts
// keeps, instead of going through enterWith(): enterWith() schedules a reset
// of the context at the next microtask checkpoint, and a domain entered by
// run() has to outlive the throw it did not catch until handleError runs.
function setStack(stack: Domain[]) {
  const value = stack.length === 0 ? undefined : stack;
  const context = $getInternalField($asyncContext, 0);
  if (context === undefined) {
    if (value !== undefined) $putInternalField($asyncContext, 0, [domainStack, value]);
    return;
  }
  const { length } = context;
  let i = 0;
  while (i < length && context[i] !== domainStack) i += 2;
  const next = context.slice();
  if (i < length) {
    if (value === undefined) {
      next.splice(i, 2);
    } else {
      next[i + 1] = value;
    }
  } else if (value !== undefined) {
    next.push(domainStack, value);
  } else {
    return;
  }
  $putInternalField($asyncContext, 0, next.length === 0 ? undefined : next);
}

function activeDomain(): Domain | undefined {
  const stack = currentStack();
  return stack === undefined ? undefined : stack[stack.length - 1];
}

// The domain entered last by enter() in the current synchronous run, or null.
// handleError uses it to tell a throw inside run()/bind()/intercept() from a
// throw in an async callback that only inherited the stack.
let syncDomain: Domain | null = null;

function setActiveDomain(domain) {
  if (domain === null || domain === undefined) {
    setStack([]);
    return;
  }
  if (activeDomain() !== domain) {
    const stack = currentStack();
    const next = stack === undefined ? [] : stack.slice();
    next.push(domain);
    setStack(next);
  }
}

ObjectDefineProperty(process, "domain", {
  __proto__: null,
  enumerable: true,
  configurable: true,
  get: activeDomain,
  set: setActiveDomain,
});

function domainUncaughtExceptionClear() {
  setStack([]);
  syncDomain = null;
}

// Called from BunProcess.cpp for every uncaught exception and unhandled
// rejection, before the process listeners, with the async context of the
// failure still active. Returns true when a domain took the error.
function handleError(er, type) {
  const stack = currentStack();
  if (stack === undefined) return false;
  const active = stack[stack.length - 1];

  if (type === "unhandledRejection") {
    // node: promiseInfo.domain.emit('error', reason). The handler runs from
    // the tick queue in node, outside every domain.
    if (active.listenerCount("error") === 0) return false;
    setStack([]);
    active.emit("error", er);
    setStack(stack);
    return true;
  }

  // node hands the error to the active domain only while a domain on the
  // stack has an 'error' listener. Inside a synchronous run() any domain on
  // the stack counts: when the inner one has no listener its emit() throws and
  // _errorHandler passes the error to the parent. In an async callback only
  // the active domain counts, as in node: the parents were on the stack when
  // the callback was created, not when it ran. Otherwise the error takes the
  // normal path with the stack cleared first (node prepends
  // domainUncaughtExceptionClear to the 'uncaughtException' listeners).
  let hasErrorListener = active.listenerCount("error") > 0;
  if (!hasErrorListener && syncDomain === active) {
    for (let i = stack.length - 2; i >= 0; i--) {
      if (stack[i].listenerCount("error") > 0) {
        hasErrorListener = true;
        break;
      }
    }
  }
  if (!hasErrorListener) {
    domainUncaughtExceptionClear();
    return false;
  }

  return active._errorHandler(er);
}

setDomainErrorHandler(handleError);

class Domain extends EventEmitter {
  members: any[];

  constructor() {
    super();
    this.members = [];
  }
}

function createDomain() {
  return new Domain();
}

Domain.prototype.members = undefined;

// Called for an error thrown while this domain was active.
Domain.prototype._errorHandler = function (er) {
  let caught = false;

  if ((typeof er === "object" && er !== null) || typeof er === "function") {
    ObjectDefineProperty(er, "domain", {
      __proto__: null,
      configurable: true,
      enumerable: false,
      value: this,
      writable: true,
    });
    er.domainThrown = true;
  }
  // Pop all adjacent duplicates of this domain from the stack so its error
  // handler does not run inside the domain itself and re-enter recursively.
  while (activeDomain() === this) {
    this.exit();
  }

  if (currentStack() === undefined) {
    // Top-level domain handler. An exception it throws is not caught here so it
    // stays fatal, as in node.
    //
    // Without an 'error' listener, do not emit: the throw from emit() would
    // end the process before the 'uncaughtException' listeners get the error.
    if (this.listenerCount("error") > 0) {
      caught = this.emit("error", er);
    }
  } else {
    // Wrap this in a try/catch so we don't get infinite throwing
    try {
      // One of three things will happen here.
      //
      // 1. There is a handler, caught = true
      // 2. There is no handler, caught = false
      // 3. It throws, caught = false
      caught = this.emit("error", er);
    } catch (er2) {
      // The domain error handler threw. See if another domain can catch THIS
      // error, or else crash on the original one.
      const stack = currentStack();
      if (stack !== undefined) {
        caught = stack[stack.length - 1]._errorHandler(er2);
      } else {
        // Pass on to the next exception handler.
        throw er2;
      }
    }
  }

  // Exit all domains on the stack. Uncaught exceptions end the current tick
  // and no domains should be left on the stack between ticks.
  domainUncaughtExceptionClear();

  return caught;
};

Domain.prototype.enter = function () {
  // Note that this might be a no-op, but we still need to push it onto the
  // stack so that we can pop it later.
  const stack = currentStack();
  const next = stack === undefined ? [] : stack.slice();
  next.push(this);
  setStack(next);
  syncDomain = this;
};

Domain.prototype.exit = function () {
  // Don't do anything if this domain is not on the stack.
  const stack = currentStack();
  if (stack === undefined) return;
  const index = stack.lastIndexOf(this);
  if (index === -1) return;

  // Exit all domains until this one.
  setStack(stack.slice(0, index));
  syncDomain = index === 0 ? null : stack[index - 1];
};

// note: this works for timers as well.
Domain.prototype.add = function (ee) {
  const { domain: previous } = ee;
  // If the domain is already added, then nothing left to do.
  if (previous === this) return;

  // Has a domain already - remove it first.
  if (previous) previous.remove(ee);

  // Check for circular Domain->Domain links.
  // They cause big issues.
  //
  // For example:
  // var d = domain.create();
  // var e = domain.create();
  // d.add(e);
  // e.add(d);
  // e.emit('error', er); // RangeError, stack overflow!
  if (ee instanceof Domain) {
    for (let d = this.domain; d; d = d.domain) {
      if (ee === d) return;
    }
  }

  ObjectDefineProperty(ee, "domain", {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: this,
    writable: true,
  });
  this.members.push(ee);
};

Domain.prototype.remove = function (ee) {
  ee.domain = null;
  const index = this.members.indexOf(ee);
  if (index !== -1) this.members.splice(index, 1);
};

Domain.prototype.run = function (fn, ...args) {
  this.enter();
  const ret = fn.$apply(this, args);
  this.exit();

  return ret;
};

function intercepted(_this, self, cb, fnargs) {
  if (fnargs[0] && fnargs[0] instanceof Error) {
    const er = fnargs[0];
    er.domainBound = cb;
    er.domainThrown = false;
    ObjectDefineProperty(er, "domain", {
      __proto__: null,
      configurable: true,
      enumerable: false,
      value: self,
      writable: true,
    });
    self.emit("error", er);
    return;
  }

  self.enter();
  const ret = cb.$apply(_this, Array.prototype.slice.$call(fnargs, 1));
  self.exit();

  return ret;
}

Domain.prototype.intercept = function (cb) {
  const self = this;

  function runIntercepted() {
    return intercepted(this, self, cb, arguments);
  }

  return runIntercepted;
};

function bound(_this, self, cb, fnargs) {
  self.enter();
  const ret = cb.$apply(_this, fnargs);
  self.exit();

  return ret;
}

Domain.prototype.bind = function (cb) {
  const self = this;

  function runBound() {
    return bound(this, self, cb, arguments);
  }

  ObjectDefineProperty(runBound, "domain", {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: this,
    writable: true,
  });

  return runBound;
};

// Override EventEmitter methods to make it domain-aware.
EventEmitter.usingDomains = true;

const eventInit = EventEmitter.init;
EventEmitter.init = function (opts) {
  ObjectDefineProperty(this, "domain", {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: null,
    writable: true,
  });
  const active = activeDomain();
  if (active !== undefined && !(this instanceof Domain)) {
    this.domain = active;
  }

  return eventInit.$call(this, opts);
};

const eventEmit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function emit(...args) {
  const domain = this.domain;

  const type = args[0];
  const shouldEmitError = type === "error" && this.listenerCount(type) > 0;

  // Just call original `emit` if current EE instance has `error`
  // handler, there's no active domain or this is process
  if (shouldEmitError || domain === null || domain === undefined || this === process) {
    return eventEmit.$apply(this, args);
  }

  if (type === "error") {
    const er = args.length > 1 && args[1] ? args[1] : $ERR_UNHANDLED_ERROR();

    if (typeof er === "object") {
      er.domainEmitter = this;
      ObjectDefineProperty(er, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: domain,
        writable: true,
      });
      er.domainThrown = false;
    }

    // Remove the active domain (and its duplicates) from the stack so the
    // domain's error handler does not run in its own context. Otherwise an
    // event emitter created or an exception thrown in that handler would
    // recursively execute that handler.
    const origStack = currentStack();
    if (origStack !== undefined) {
      const origActive = origStack[origStack.length - 1];
      let idx = origStack.length - 1;
      while (idx > -1 && origStack[idx] === origActive) {
        --idx;
      }
      setStack(idx < 0 ? [] : origStack.slice(0, idx + 1));
    }

    domain.emit("error", er);

    // Now that the domain's error handler has completed, restore the domains
    // stack and the active domain to their original values.
    if (origStack !== undefined) {
      setStack(origStack);
    }

    return false;
  }

  domain.enter();
  const ret = eventEmit.$apply(this, args);
  domain.exit();

  return ret;
};

export default {
  Domain,
  create: createDomain,
  createDomain,
  // The active domain is always the one that we're currently in.
  get active() {
    return activeDomain() ?? null;
  },
  set active(domain) {
    setActiveDomain(domain);
  },
  // The stack of entered domains, innermost last.
  get _stack() {
    const stack = currentStack();
    return stack === undefined ? [] : stack;
  },
};
