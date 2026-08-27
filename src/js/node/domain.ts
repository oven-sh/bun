// Hardcoded module "node:domain"
//
// Port of node's lib/domain.js (the AsyncLocalStorage-based version on node's
// main branch). The stack of entered domains lives in the async context, so a
// callback runs with the stack it was created under. BunProcess.cpp calls
// `handleError` for every uncaught exception and unhandled rejection before
// the process listeners, with the async context of the failure still active.

const EventEmitter = require("node:events");
const { AsyncLocalStorage } = require("node:async_hooks");

const setDomainErrorHandler = $newCppFunction("BunProcess.cpp", "jsFunctionSetDomainErrorHandler", 1);

const ObjectDefineProperty = Object.defineProperty;
const ObjectHasOwn = Object.hasOwn;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeLastIndexOf = Array.prototype.lastIndexOf;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;

// The domains entered and not yet exited, innermost last, or undefined. Never
// mutated in place: a callback that snapshotted the old context keeps its stack.
const domainStack = new AsyncLocalStorage();

function currentStack(): Domain[] | undefined {
  return domainStack.getStore();
}

// Not enterWith(): that schedules a context reset at the next microtask
// checkpoint, before a throw out of run() reaches handleError.
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
  const next = ArrayPrototypeSlice.$call(context);
  if (i < length) {
    if (value === undefined) {
      ArrayPrototypeSplice.$call(next, i, 2);
    } else {
      next[i + 1] = value;
    }
  } else if (value !== undefined) {
    ArrayPrototypePush.$call(next, domainStack, value);
  } else {
    return;
  }
  $putInternalField($asyncContext, 0, next.length === 0 ? undefined : next);
}

function activeDomain(): Domain | undefined {
  const stack = currentStack();
  return stack === undefined ? undefined : stack[stack.length - 1];
}

// The stack array the innermost enter() still in effect installed. A context
// restored for an async callback holds the array that was current when the
// callback was created, never this one, which tells a throw inside run() from
// a throw in a callback that only inherited its stack.
let syncStack: Domain[] | undefined;
// One record per enter() still in effect: what exit() puts back.
const syncEntries: { domain: Domain; stack: Domain[] | undefined; syncStack: Domain[] | undefined }[] = [];

function setActiveDomain(domain) {
  if (domain === null || domain === undefined) {
    setStack([]);
    return;
  }
  if (activeDomain() !== domain) {
    const stack = currentStack();
    const next = stack === undefined ? [] : ArrayPrototypeSlice.$call(stack);
    ArrayPrototypePush.$call(next, domain);
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
  syncEntries.length = 0;
  syncStack = undefined;
}

// Returns true when a domain took the error.
function handleError(er, type) {
  const stack = currentStack();
  if (stack === undefined) return false;
  const active = stack[stack.length - 1];

  if (type === "unhandledRejection") {
    // node: promiseInfo.domain.emit('error', reason), outside every domain.
    if (active.listenerCount("error") === 0) return false;
    setStack([]);
    try {
      active.emit("error", er);
    } finally {
      setStack(stack);
    }
    return true;
  }

  // Like node, a parent domain's 'error' listener only counts for a throw
  // inside a synchronous run(). An async callback had only the active domain
  // entered for it, so without a listener there the error takes the normal path.
  let hasErrorListener = active.listenerCount("error") > 0;
  if (!hasErrorListener && stack === syncStack) {
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

  // Like node's capture callback, the result of _errorHandler is not consulted:
  // with a listener on the stack it delivers the error or throws. emit() returns
  // false when it routed the error to the domain's own parent domain.
  active._errorHandler(er);
  return true;
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
  // The handler must not run inside the domain it handles errors for.
  while (activeDomain() === this) {
    this.exit();
  }

  if (currentStack() === undefined) {
    // Top-level handler: a throw from it stays fatal. Without a listener emit()
    // would throw before the 'uncaughtException' listeners see the error.
    if (this.listenerCount("error") > 0) {
      caught = this.emit("error", er);
    }
  } else {
    try {
      caught = this.emit("error", er);
    } catch (er2) {
      // The handler threw: the next domain on the stack gets that error.
      const stack = currentStack();
      if (stack !== undefined) {
        caught = stack[stack.length - 1]._errorHandler(er2);
      } else {
        throw er2;
      }
    }
  }

  // An uncaught exception ends the tick: no domain stays entered after it.
  domainUncaughtExceptionClear();

  return caught;
};

Domain.prototype.enter = function () {
  const stack = currentStack();
  // Records left by an enter() whose exit() a caught throw skipped belong to
  // an earlier synchronous run once the current stack is no longer theirs.
  if (stack !== syncStack) syncEntries.length = 0;
  const next = stack === undefined ? [] : ArrayPrototypeSlice.$call(stack);
  ArrayPrototypePush.$call(next, this);
  setStack(next);
  ArrayPrototypePush.$call(syncEntries, { domain: this, stack, syncStack });
  syncStack = next;
};

Domain.prototype.exit = function () {
  const stack = currentStack();
  if (stack === undefined) return;
  const index = ArrayPrototypeLastIndexOf.$call(stack, this);
  if (index === -1) return;

  // Exit all domains until this one.
  let i = syncEntries.length - 1;
  while (i >= 0 && syncEntries[i].domain !== this) i--;
  if (i === -1) {
    setStack(ArrayPrototypeSlice.$call(stack, 0, index));
    return;
  }
  const entry = syncEntries[i];
  syncEntries.length = i;
  setStack(entry.stack === undefined ? [] : entry.stack);
  syncStack = entry.syncStack;
};

Domain.prototype.add = function (ee) {
  const { domain: previous } = ee;
  if (previous === this) return;
  if (previous) previous.remove(ee);

  // A Domain->Domain cycle would make emit('error') recurse forever.
  if (ee instanceof Domain) {
    for (let d = this; d; d = d.domain) {
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
  ArrayPrototypePush.$call(this.members, ee);
};

Domain.prototype.remove = function (ee) {
  ee.domain = null;
  const index = ArrayPrototypeIndexOf.$call(this.members, ee);
  if (index !== -1) ArrayPrototypeSplice.$call(this.members, index, 1);
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
  const ret = cb.$apply(_this, ArrayPrototypeSlice.$call(fnargs, 1));
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

  const ret = eventInit.$call(this, opts);

  // A captureRejections emitter gets its own `emit` from events.ts.
  if (ObjectHasOwn(this, "emit")) {
    const ownEmit = this.emit;
    this.emit = function emit(...args) {
      return emitWithDomain(this, ownEmit, args);
    };
  }

  return ret;
};

const eventEmit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function emit(...args) {
  return emitWithDomain(this, eventEmit, args);
};

function emitWithDomain(emitter, originalEmit, args) {
  const domain = emitter.domain;

  const type = args[0];
  const shouldEmitError = type === "error" && emitter.listenerCount(type) > 0;

  if (shouldEmitError || domain === null || domain === undefined || emitter === process) {
    return originalEmit.$apply(emitter, args);
  }

  if (type === "error") {
    const er = args.length > 1 && args[1] ? args[1] : $ERR_UNHANDLED_ERROR();

    if (typeof er === "object") {
      er.domainEmitter = emitter;
      ObjectDefineProperty(er, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: domain,
        writable: true,
      });
      er.domainThrown = false;
    }

    // The handler runs outside the active domain (and its duplicates) so it
    // cannot re-enter itself through an emitter created or a throw inside it.
    const origStack = currentStack();
    const origSyncStack = syncStack;
    if (origStack !== undefined) {
      const origActive = origStack[origStack.length - 1];
      let idx = origStack.length - 1;
      while (idx > -1 && origStack[idx] === origActive) {
        --idx;
      }
      setStack(idx < 0 ? [] : ArrayPrototypeSlice.$call(origStack, 0, idx + 1));
      syncStack = currentStack();
    }

    domain.emit("error", er);

    if (origStack !== undefined) {
      setStack(origStack);
      syncStack = origSyncStack;
    }

    return false;
  }

  domain.enter();
  const ret = originalEmit.$apply(emitter, args);
  domain.exit();

  return ret;
}

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
