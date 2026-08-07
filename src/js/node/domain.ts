// Hardcoded module "node:domain"
// Port of node v26.3.0 lib/domain.js. Async propagation rides on
// AsyncLocalStorage instead of node's createHook init/before/after hooks.
const EventEmitter = require("node:events");
const asyncHooks = require("node:async_hooks");
const { AsyncLocalStorage } = asyncHooks;

const ObjectDefineProperty = Object.defineProperty;
const ArrayPrototypeLastIndexOf = Array.prototype.lastIndexOf;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;
const ArrayPrototypePush = Array.prototype.push;
// Captured so userland prototype/global patches can't hijack dispatch.
const AlsGetStore = AsyncLocalStorage.prototype.getStore;
const AlsEnterWith = AsyncLocalStorage.prototype.enterWith;
const ProcessNextTick = process.nextTick;

const setDomainErrorHandler = $newCppFunction("BunProcess.cpp", "jsFunctionSetDomainErrorHandler", 2);

const exports: any = {};

// Each ALS box snapshots {d: activeDomain, token}; the stack stays global.
const als = new AsyncLocalStorage();

// node lib/domain.js module-global stack; survives thrown exceptions.
let stack: any[] = [];

// node lib/domain.js `exports.active`.
let globalActive: any = null;

// A stale box.token means node's before() hook would have fired for the callback.
let currentToken = 0;

function setActive(d: any) {
  globalActive = d;
  AlsEnterWith.$call(als, { d, token: ++currentToken });
}

function isCurrentExecution(box: any): boolean {
  return box !== undefined && box.token === currentToken;
}

// Equivalent of node's before() hook about to enter box.d. Node's init hook
// stores process.domain[kWeak], undefined for a non-Domain, so filter those.
function isRestoredPairing(box: any): boolean {
  return box !== undefined && box.token !== currentToken && box.d != null && typeof box.d._errorHandler === "function";
}

// Lazy equivalent of node's after() hook exiting the adopted pairing.
let adoptedDomain: any = null;
let adoptedIndex = -1;

function unadopt() {
  if (adoptedDomain === null) return;
  if (adoptedIndex < stack.length && stack[adoptedIndex] === adoptedDomain) {
    stack.length = adoptedIndex;
    globalActive = stack.length === 0 ? undefined : stack[stack.length - 1];
    ++currentToken;
  }
  adoptedDomain = null;
  adoptedIndex = -1;
}

function currentActive(): any {
  const box = AlsGetStore.$call(als);
  if (isCurrentExecution(box)) return globalActive;
  unadopt();
  if (isRestoredPairing(box)) return box.d;
  return globalActive;
}

function currentStack(): any[] {
  const box = AlsGetStore.$call(als);
  if (isCurrentExecution(box)) return stack;
  unadopt();
  if (isRestoredPairing(box)) {
    // node's before() hook pushes unconditionally on top of the global stack.
    const s = ArrayPrototypeSlice.$call(stack);
    ArrayPrototypePush.$call(s, box.d);
    return s;
  }
  return stack;
}

// node before() hook equivalent: enter the paired domain on the global stack.
function adopt() {
  const box = AlsGetStore.$call(als);
  if (isCurrentExecution(box)) return;
  unadopt();
  if (isRestoredPairing(box)) {
    adoptedDomain = box.d;
    adoptedIndex = stack.length;
    ArrayPrototypePush.$call(stack, box.d);
    setActive(box.d);
  }
}

// The process.domain setter needs a post-tick token bump so callbacks see a
// restored pairing (node lib/domain.js:102 init hook reads process.domain).
let tokenRetireQueued = false;

function retireToken() {
  tokenRetireQueued = false;
  ++currentToken;
}

function retireTokenAfterTick() {
  if (tokenRetireQueued) return;
  tokenRetireQueued = true;
  ProcessNextTick.$call(process, retireToken);
}

// node lib/domain.js backs process.domain with _domain[0].
ObjectDefineProperty(process, "domain", {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: function () {
    return currentActive();
  },
  set: function (arg: any) {
    adopt();
    setActive(arg);
    retireTokenAfterTick();
  },
} as PropertyDescriptor);

// Accessor because the observable stack includes the async pairing.
ObjectDefineProperty(exports, "_stack", {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: function () {
    return currentStack();
  },
  set: function (arg: any) {
    stack = arg;
  },
} as PropertyDescriptor);

// The active domain is always the one that we're currently in.
ObjectDefineProperty(exports, "active", {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: function () {
    return currentActive();
  },
  set: function (arg: any) {
    adopt();
    setActive(arg);
  },
} as PropertyDescriptor);

// node should_abort_on_uncaught_toggle equivalent (lib/domain.js updateExceptionCapture).
function domainWouldClaim(): boolean {
  const s = currentStack();
  const len = s.length;
  for (let i = 0; i < len; i++) {
    const d = s[i];
    // _errorHandler filters non-Domain values; fatalErrorDispatch never routes into one.
    if (
      d != null &&
      typeof d._errorHandler === "function" &&
      typeof d.listenerCount === "function" &&
      d.listenerCount("error") > 0
    ) {
      return true;
    }
  }
  return false;
}

function domainUncaughtExceptionClear() {
  adoptedDomain = null;
  adoptedIndex = -1;
  stack.length = 0;
  setActive(null);
}

// Called from Bun__handleUncaughtException before the capture callback /
// 'uncaughtException' listeners (node hooks into process._fatalException).
function fatalErrorDispatch(er: any) {
  adopt();
  let active = globalActive;
  const stackLen = stack.length;
  if ((active === null || active === undefined) && stackLen > 0) {
    // Userland nulled process.domain with domains still on the stack.
    active = stack[stackLen - 1];
    setActive(active);
  }
  // Non-Domain values fall through (node never routes into them either).
  if (active !== null && active !== undefined && typeof active._errorHandler === "function") {
    if (stack.length === 0 || stack[stack.length - 1] !== active) {
      ArrayPrototypePush.$call(stack, active);
      setActive(active);
    }
    // node updateExceptionCapture(): route only if some domain has an 'error' listener.
    // d != null: the _stack setter accepts arbitrary userland arrays.
    for (let i = 0; i < stack.length; i++) {
      const d = stack[i];
      if (d != null && typeof d.listenerCount === "function" && d.listenerCount("error") > 0) {
        active._errorHandler(er);
        return true;
      }
    }
  }
  // node prepends domainUncaughtExceptionClear as an 'uncaughtException' listener.
  domainUncaughtExceptionClear();
  return false;
}

class Domain extends EventEmitter {
  members: any[];

  constructor() {
    super();
    this.members = [];
  }

  // Port of node lib/domain.js Domain.prototype._errorHandler.
  _errorHandler(er: any) {
    let caught = false;

    if ((typeof er === "object" && er !== null) || typeof er === "function") {
      ObjectDefineProperty(er, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: this,
        writable: true,
      } as PropertyDescriptor);
      er.domainThrown = true;
    }
    // node: pop adjacent duplicates so the handler doesn't run in its own context.
    while (currentActive() === this) {
      this.exit();
    }

    // node: top-level handler throws escape to the fatal path (exit 7).
    if (stack.length === 0) {
      if (this.listenerCount("error") > 0) {
        caught = this.emit("error", er);
      }
    } else {
      try {
        caught = this.emit("error", er);
      } catch (er2) {
        // node: try the next domain on the stack, else re-throw.
        const remaining = stack.length;
        if (remaining) {
          setActive(stack[remaining - 1]);
          caught = currentActive()._errorHandler(er2);
        } else {
          throw er2;
        }
      }
    }

    domainUncaughtExceptionClear();

    return caught;
  }

  enter() {
    adopt();
    ArrayPrototypePush.$call(stack, this);
    setActive(this);
  }

  exit() {
    adopt();
    const index = ArrayPrototypeLastIndexOf.$call(stack, this);
    if (index === -1) return;
    ArrayPrototypeSplice.$call(stack, index);

    setActive(stack.length === 0 ? undefined : stack[stack.length - 1]);
  }

  add(ee: any) {
    const eeDomain = ee.domain;
    if (eeDomain === this) return;
    if (eeDomain) eeDomain.remove(ee);

    // node: reject circular Domain->Domain links (stack overflow on error emit).
    const thisDomain = this.domain;
    if (thisDomain && ee instanceof Domain) {
      for (let d = thisDomain; d; d = d.domain) {
        if (ee === d) return;
      }
    }

    ObjectDefineProperty(ee, "domain", {
      __proto__: null,
      configurable: true,
      enumerable: false,
      value: this,
      writable: true,
    } as PropertyDescriptor);
    ArrayPrototypePush.$call(this.members, ee);
  }

  remove(ee: any) {
    ee.domain = null;
    const index = ArrayPrototypeIndexOf.$call(this.members, ee);
    if (index !== -1) ArrayPrototypeSplice.$call(this.members, index, 1);
  }

  run(fn: any) {
    this.enter();
    const ret = fn.$apply(this, ArrayPrototypeSlice.$call(arguments, 1));
    this.exit();

    return ret;
  }

  intercept(cb: any) {
    const self = this;

    function runIntercepted(this: any) {
      return intercepted(this, self, cb, arguments);
    }

    return runIntercepted;
  }

  bind(cb: any) {
    const self = this;

    function runBound(this: any) {
      return bound(this, self, cb, arguments);
    }

    ObjectDefineProperty(runBound, "domain", {
      __proto__: null,
      configurable: true,
      enumerable: false,
      value: this,
      writable: true,
    } as PropertyDescriptor);

    return runBound;
  }
}

function intercepted(_this: any, self: any, cb: any, fnargs: IArguments) {
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
    } as PropertyDescriptor);
    self.emit("error", er);
    return;
  }

  self.enter();
  const ret = cb.$apply(_this, ArrayPrototypeSlice.$call(fnargs, 1));
  self.exit();

  return ret;
}

function bound(_this: any, self: any, cb: any, fnargs: IArguments) {
  self.enter();
  const ret = cb.$apply(_this, fnargs);
  self.exit();

  return ret;
}

exports.Domain = Domain;

exports.create = exports.createDomain = function createDomain() {
  return new Domain();
};

// Override EventEmitter methods to make it domain-aware.
EventEmitter.usingDomains = true;

const eventEmit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function emit(this: any, ...args: any[]) {
  const domain = this.domain;

  const type = args[0];
  const shouldEmitError = type === "error" && this.listenerCount(type) > 0;

  if (shouldEmitError || domain === null || domain === undefined || this === process) {
    return eventEmit.$apply(this, args);
  }

  if (type === "error") {
    const er = args.length > 1 && args[1] ? args[1] : $ERR_UNHANDLED_ERROR();

    adopt();

    if (typeof er === "object") {
      er.domainEmitter = this;
      ObjectDefineProperty(er, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: domain,
        writable: true,
      } as PropertyDescriptor);
      er.domainThrown = false;
    }

    // node: prune duplicates so the error handler doesn't run in its own context.
    const origDomainsStack = ArrayPrototypeSlice.$call(stack);
    const origActiveDomain = currentActive();
    let idx = stack.length - 1;
    while (idx > -1 && origActiveDomain === stack[idx]) {
      --idx;
    }

    if (idx < 0) {
      stack.length = 0;
    } else {
      ArrayPrototypeSplice.$call(stack, idx + 1);
    }

    setActive(stack.length > 0 ? stack[stack.length - 1] : null);

    domain.emit("error", er);

    stack = origDomainsStack;
    setActive(origActiveDomain);

    return false;
  }

  domain.enter();
  const ret = eventEmit.$apply(this, args);
  domain.exit();

  return ret;
};

const eventInit = EventEmitter.init;
EventEmitter.init = function init(this: any, opts: any) {
  ObjectDefineProperty(this, "domain", {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: null,
    writable: true,
  } as PropertyDescriptor);
  // node init reads exports.active (always a real Domain or null); filter non-Domains.
  const active = currentActive();
  if (active && typeof active._errorHandler === "function" && !(this instanceof Domain)) {
    this.domain = active;
  }

  return eventInit.$call(this, opts);
};

// Mirror node registering its createHook init hook / captureFn at load time.
asyncHooks[Symbol.for("::bunternal::async_hooks.setDomainActiveGetter")](currentActive);
setDomainErrorHandler(fatalErrorDispatch, domainWouldClaim);

export default exports;
