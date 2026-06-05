// Hardcoded module "node:domain"
// Port of Node.js lib/domain.js.
//
// Node implements domain propagation with async_hooks.createHook: the init
// hook pairs every async resource with the domain that was active when it
// was created, and the before/after hooks enter/exit that domain around the
// resource's callbacks. Bun does not implement createHook, so this port
// rides on Bun's AsyncLocalStorage context propagation instead: the active
// domain is stored in an AsyncLocalStorage, which Bun's AsyncContextFrame
// machinery snapshots at schedule time and restores around every callback —
// the same pairing semantics the init hook provides. The synchronous domain
// stack is a module-global array exactly like node's; the uncaught-exception
// dispatcher below reconciles the two on async boundaries (the equivalent of
// node's before() hook running `domain.enter()`).
//
// Uncaught-exception routing uses a dedicated native dispatch slot
// (jsFunctionSetDomainErrorHandler in BunProcess.cpp) consulted by
// Bun__handleUncaughtException before the public capture callback and
// 'uncaughtException' listeners, mirroring where node's domain hooks into
// process._fatalException.
const EventEmitter = require("node:events");
const { AsyncLocalStorage } = require("node:async_hooks");

const ObjectDefineProperty = Object.defineProperty;
const ObjectHasOwn = Object.hasOwn;
const ArrayPrototypeLastIndexOf = Array.prototype.lastIndexOf;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;
const ArrayPrototypePush = Array.prototype.push;

const setDomainErrorHandler = $newCppFunction("BunProcess.cpp", "jsFunctionSetDomainErrorHandler", 1);

const exports: any = {};

// The domain context, carried through async boundaries by the async-context
// machinery. Each box snapshots the active domain and a token identifying
// the synchronous execution that wrote it (see the notes on writeBox/adopt
// below). Boxes are immutable; every state change writes a fresh one. The
// domain stack itself is not in the box — it is the module-global below.
const als = new AsyncLocalStorage();

// It's possible to enter one domain while already inside another one. The
// stack is each entered domain, exactly like node's module-global stack.
// Synchronous enter()/exit() mutate it; it intentionally survives thrown
// exceptions (no unwinding), which is what lets the uncaught-exception
// dispatcher see the domains that were active at throw time.
let stack: any[] = [];

// node's `exports.active` global: null initially and after an uncaught
// exception, undefined after exiting the last domain on the stack.
let globalActive: any = null;

// Bumped by every state change and recorded in the box it writes. When a
// callback later runs with a box whose token no longer matches, the box was
// captured by an earlier synchronous execution and restored across an async
// boundary — the AsyncLocalStorage equivalent of node's before() hook
// firing for the callback's async resource.
let currentToken = 0;

function writeBox(d: any) {
  globalActive = d;
  als.enterWith({ d, token: ++currentToken });
}

// True when the box was written by the currently-running synchronous
// execution, i.e. the module globals already describe this context.
function isCurrentExecution(box: any): boolean {
  return box !== undefined && box.token === currentToken;
}

// True when the current code runs in an async callback whose scheduling
// context had an active domain, i.e. the equivalent of node's before() hook
// being about to enter `box.d`. A box with a null/undefined active is not a
// pairing: node resources created with no active domain observe the module
// globals at callback time, exactly like synchronous code does.
function isRestoredPairing(box: any): boolean {
  return box !== undefined && box.token !== currentToken && box.d != null;
}

// adopt() (below) may have entered a paired domain on the global stack for
// an async callback that has since returned. Node's after() hook would have
// exited it at return time; with no hook to run then, the next domain-state
// access from a different execution context undoes it lazily here. Like
// node's Domain.prototype.exit, this also discards anything entered above
// the pairing that was never exited.
let adoptedDomain: any = null;
let adoptedIndex = -1;

function unadopt() {
  if (adoptedDomain === null) return;
  if (adoptedIndex < stack.length && stack[adoptedIndex] === adoptedDomain) {
    stack.length = adoptedIndex;
    globalActive = stack.length === 0 ? undefined : stack[stack.length - 1];
    // Invalidate boxes captured while the pairing was entered: callbacks
    // still holding them must re-enter their pairing instead of trusting
    // the (now rewound) globals.
    ++currentToken;
  }
  adoptedDomain = null;
  adoptedIndex = -1;
}

function currentActive(): any {
  const box = als.getStore();
  if (isCurrentExecution(box)) return globalActive;
  unadopt();
  if (isRestoredPairing(box)) return box.d;
  return globalActive;
}

function currentStack(): any[] {
  const box = als.getStore();
  if (isCurrentExecution(box)) return stack;
  unadopt();
  if (isRestoredPairing(box)) {
    // What the stack would look like after node's before() hook entered the
    // callback's paired domain on top of the residual global stack (the
    // hook pushes unconditionally, so no de-duplication here).
    const s = ArrayPrototypeSlice.$call(stack);
    ArrayPrototypePush.$call(s, box.d);
    return s;
  }
  return stack;
}

// Called before mutating the domain state: if we're inside an async callback
// paired with a domain, enter that domain on the global stack first, like
// node's before() hook does at callback start. Writing the box marks the
// pairing as entered so this happens at most once per callback.
function adopt() {
  const box = als.getStore();
  if (isCurrentExecution(box)) return;
  unadopt();
  if (isRestoredPairing(box)) {
    adoptedDomain = box.d;
    adoptedIndex = stack.length;
    ArrayPrototypePush.$call(stack, box.d);
    writeBox(box.d);
  }
}

function setActive(d: any) {
  writeBox(d);
}

// Overwrite process.domain with a getter/setter. Node backs this with
// _domain[0]; here it reads through to the async-local active domain.
ObjectDefineProperty(process, "domain", {
  __proto__: null,
  enumerable: true,
  get: function () {
    return currentActive();
  },
  set: function (arg: any) {
    setActive(arg);
  },
} as PropertyDescriptor);

ObjectDefineProperty(exports, "_stack", {
  __proto__: null,
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
  enumerable: true,
  get: function () {
    return currentActive();
  },
  set: function (arg: any) {
    setActive(arg);
  },
} as PropertyDescriptor);

function domainUncaughtExceptionClear() {
  adoptedDomain = null;
  adoptedIndex = -1;
  stack.length = 0;
  setActive(null);
}

// Called from the native uncaught-exception path (before the public capture
// callback and 'uncaughtException' listeners). Returning a truthy value
// marks the exception as handled; falsy falls through to the regular
// process-level handling.
function fatalErrorDispatch(er: any) {
  // If the throw came from an async callback, enter the callback's
  // scheduling-time domain context like node's before() hook would have at
  // callback start.
  adopt();
  let active = globalActive;
  if ((active === null || active === undefined) && stack.length > 0) {
    // A synchronous throw unwound to the native fatal path without running
    // any exit()s, and the async-local box doesn't survive the unwind (the
    // context frame is restored when evaluation pops). The synchronous
    // stack intentionally does survive — it records the domains entered at
    // throw time, so the top of it is the active domain node would see.
    active = stack[stack.length - 1];
    setActive(active);
  }
  if (active !== null && active !== undefined) {
    // The domain set via the process.domain setter (or an async pairing
    // installed without enter()) may not be on the stack yet; node's
    // before() hook pushes it before running the callback.
    if (stack.length === 0 || stack[stack.length - 1] !== active) {
      ArrayPrototypePush.$call(stack, active);
      setActive(active);
    }
    // Node only routes the exception into the domain when some domain on
    // the stack has an 'error' listener (updateExceptionCapture()).
    for (let i = 0; i < stack.length; i++) {
      if (stack[i].listenerCount("error") > 0) {
        return active._errorHandler(er);
      }
    }
  }
  // Not handled by a domain: clear the domain stack like node's prepended
  // domainUncaughtExceptionClear 'uncaughtException' listener does, then let
  // the native path continue with 'uncaughtException' listeners or the
  // default fatal handling.
  domainUncaughtExceptionClear();
  return false;
}

class Domain extends EventEmitter {
  members: any[];

  constructor() {
    super();
    this.members = [];
  }

  // Called by the native uncaught-exception dispatch in case an error was
  // thrown. This is a port of node's Domain.prototype._errorHandler.
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
    // Pop all adjacent duplicates of the currently active domain from the
    // stack. This is done to prevent a domain's error handler from running
    // within the context of itself, and re-entering itself recursively as a
    // result of an exception thrown in its context.
    while (currentActive() === this) {
      this.exit();
    }

    // The top-level domain-handler is handled separately. An exception
    // thrown from the top-level handler must escape to the native fatal
    // path (which honors --abort-on-uncaught-exception and exits with code
    // 7) rather than being swallowed by a try/catch here.
    if (stack.length === 0) {
      // If there's no error handler, do not emit an 'error' event as this
      // would throw an error, make the process exit, and thus prevent the
      // process 'uncaughtException' event from being emitted if a listener
      // is set.
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
        //
        // If caught is false after this, then there's no need to exit() the
        // domain, because we're going to crash the process anyway.
        caught = this.emit("error", er);
      } catch (er2) {
        // The domain error handler threw! oh no!
        // See if another domain can catch THIS error, or else crash on the
        // original one.
        if (stack.length) {
          setActive(stack[stack.length - 1]);
          caught = currentActive()._errorHandler(er2);
        } else {
          // Pass on to the native exception handler.
          throw er2;
        }
      }
    }

    // Exit all domains on the stack. Uncaught exceptions end the current
    // tick and no domains should be left on the stack between ticks.
    domainUncaughtExceptionClear();

    return caught;
  }

  enter() {
    adopt();
    // Note that this might be a no-op, but we still need to push it onto
    // the stack so that we can pop it later.
    ArrayPrototypePush.$call(stack, this);
    setActive(this);
  }

  exit() {
    adopt();
    // Don't do anything if this domain is not on the stack.
    const index = ArrayPrototypeLastIndexOf.$call(stack, this);
    if (index === -1) return;

    // Exit all domains until this one.
    ArrayPrototypeSplice.$call(stack, index);

    setActive(stack.length === 0 ? undefined : stack[stack.length - 1]);
  }

  // note: this works for timers as well.
  add(ee: any) {
    // If the domain is already added, then nothing left to do.
    if (ee.domain === this) return;

    // Has a domain already - remove it first.
    if (ee.domain) ee.domain.remove(ee);

    // Check for circular Domain->Domain links.
    // They cause big issues.
    //
    // For example:
    // var d = domain.create();
    // var e = domain.create();
    // d.add(e);
    // e.add(d);
    // e.emit('error', er); // RangeError, stack overflow!
    if (this.domain && ee instanceof Domain) {
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

// Marks emit functions produced by makeDomainAwareEmit so instances are
// never double-wrapped.
const kDomainAwareEmit = Symbol("kDomainAwareEmit");

// Wraps an emit implementation with node's domain integration. Used for
// EventEmitter.prototype.emit and for the capture-rejections emit that
// Bun's EventEmitter.init installs as an own instance property (an own
// property would otherwise shadow the prototype override entirely, so
// captureRejections emitters would bypass domains).
function makeDomainAwareEmit(innerEmit: any) {
  function emit(this: any, ...args: any[]) {
    const domain = this.domain;

    const type = args[0];
    const shouldEmitError = type === "error" && this.listenerCount(type) > 0;

    // Just call original `emit` if current EE instance has `error` handler,
    // there's no active domain or this is process
    if (shouldEmitError || domain === null || domain === undefined || this === process) {
      return innerEmit.$apply(this, args);
    }

    if (type === "error") {
      const er = args.length > 1 && args[1] ? args[1] : $ERR_UNHANDLED_ERROR();

      // Enter the async callback's scheduling-time domain context (node's
      // before() hook equivalent) before manipulating the stack below.
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

      // Remove the current domain (and its duplicates) from the domains stack
      // and set the active domain to its parent (if any) so that the domain's
      // error handler doesn't run in its own context. This prevents any event
      // emitter created or any exception thrown in that error handler from
      // recursively executing that error handler.
      const origDomainsStack = ArrayPrototypeSlice.$call(stack);
      const origActiveDomain = currentActive();

      // Travel the domains stack from top to bottom to find the first domain
      // instance that is not a duplicate of the current active domain.
      let idx = stack.length - 1;
      while (idx > -1 && origActiveDomain === stack[idx]) {
        --idx;
      }

      // Change the stack to not contain the current active domain, and only
      // the domains above it on the stack.
      if (idx < 0) {
        stack.length = 0;
      } else {
        ArrayPrototypeSplice.$call(stack, idx + 1);
      }

      // Change the current active domain
      setActive(stack.length > 0 ? stack[stack.length - 1] : null);

      domain.emit("error", er);

      // Now that the domain's error handler has completed, restore the
      // domains stack and the active domain to their original values.
      stack = origDomainsStack;
      setActive(origActiveDomain);

      return false;
    }

    domain.enter();
    const ret = innerEmit.$apply(this, args);
    domain.exit();

    return ret;
  }
  emit[kDomainAwareEmit] = true;
  return emit;
}

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
  if (active && !(this instanceof Domain)) {
    this.domain = active;
  }

  const ret = eventInit.$call(this, opts);

  // Bun's EventEmitter.init installs a capture-rejections emit variant as an
  // own instance property when captureRejections is enabled (node instead
  // branches on kCapture inside the single prototype emit). An own property
  // shadows the domain-aware prototype emit, so wrap it here too.
  if (ObjectHasOwn(this, "emit") && typeof this.emit === "function" && !this.emit[kDomainAwareEmit]) {
    this.emit = makeDomainAwareEmit(this.emit);
  }

  return ret;
};

const eventEmit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = makeDomainAwareEmit(eventEmit);

// Hook the native uncaught-exception path. This is installed once when the
// domain module is first loaded, like node's per-Domain asyncHook.enable().
setDomainErrorHandler(fatalErrorDispatch);

export default exports;
