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
const AlsGetStore = AsyncLocalStorage.prototype.getStore;
const AlsEnterWith = AsyncLocalStorage.prototype.enterWith;
const ProcessNextTick = process.nextTick;

const setDomainErrorHandler = $newCppFunction("BunProcess.cpp", "jsFunctionSetDomainErrorHandler", 2);

const exports: any = {};

// Each ALS box snapshots {d: activeDomain, token}; the stack stays global.
const als = new AsyncLocalStorage();

let stack: any[] = [];

let globalActive: any = null;

// A stale box.token means node's before() hook would have fired for the callback.
let currentToken = 0;

// Tick-boundary stand-in for the after() hook:
// https://github.com/nodejs/node/blob/v26.3.0/lib/domain.js#L106
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

function setActive(d: any) {
  globalActive = d;
  AlsEnterWith.$call(als, { d, token: ++currentToken });
  retireTokenAfterTick();
}

function isCurrentExecution(box: any): boolean {
  return box !== undefined && box.token === currentToken;
}

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
  },
} as PropertyDescriptor);

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

function domainWouldClaim(): boolean {
  const s = currentStack();
  const len = s.length;
  for (let i = 0; i < len; i++) {
    const d = s[i];
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

function fatalErrorDispatch(er: any) {
  adopt();
  let active = globalActive;
  const stackLen = stack.length;
  if ((active === null || active === undefined) && stackLen > 0) {
    active = stack[stackLen - 1];
    setActive(active);
  }
  if (active !== null && active !== undefined && typeof active._errorHandler === "function") {
    if (stack.length === 0 || stack[stack.length - 1] !== active) {
      ArrayPrototypePush.$call(stack, active);
      setActive(active);
    }
    for (let i = 0; i < stack.length; i++) {
      const d = stack[i];
      if (d != null && typeof d.listenerCount === "function" && d.listenerCount("error") > 0) {
        active._errorHandler(er);
        return true;
      }
    }
  }
  domainUncaughtExceptionClear();
  return false;
}

class Domain extends EventEmitter {
  members: any[];

  constructor() {
    super();
    this.members = [];
  }

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
    while (currentActive() === this && ArrayPrototypeLastIndexOf.$call(stack, this) !== -1) {
      this.exit();
    }

    if (stack.length === 0) {
      if (this.listenerCount("error") > 0) {
        caught = this.emit("error", er);
      }
    } else {
      try {
        caught = this.emit("error", er);
      } catch (er2) {
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
  const active = currentActive();
  if (active && typeof active._errorHandler === "function" && !(this instanceof Domain)) {
    this.domain = active;
  }

  return eventInit.$call(this, opts);
};

asyncHooks[Symbol.for("::bunternal::async_hooks.setDomainActiveGetter")](currentActive);
setDomainErrorHandler(fatalErrorDispatch, domainWouldClaim);

export default exports;
