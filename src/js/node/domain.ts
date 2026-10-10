const EventEmitter = require("node:events");

const ObjectDefineProperty = Object.defineProperty;

// Domains entered via enter()/run() and not yet exited, innermost last.
// process.domain mirrors the top of the stack like in node so other modules
// can observe the currently active domain.
const stack: any[] = [];

const kEmitError = Symbol("kEmitError");

// Like node, requiring the module defines process.domain (null until a domain
// is entered, undefined again after the last one exits).
let activeDomain: any = null;
ObjectDefineProperty(process, "domain", {
  __proto__: null,
  enumerable: true,
  configurable: true,
  get() {
    return activeDomain;
  },
  set(value) {
    activeDomain = value;
  },
} as PropertyDescriptor);

function setActive(d) {
  domain.active = activeDomain = d;
}

class Domain extends EventEmitter {
  members: any[];
  [kEmitError]: (e?: any) => void;

  constructor() {
    super();
    this.members = [];
    const self = this;
    // A regular function so `this` is the emitter that emitted "error".
    this[kEmitError] = function emitError(e) {
      // Like node: every falsy value becomes ERR_UNHANDLED_ERROR, truthy non-objects pass through.
      e ||= $ERR_UNHANDLED_ERROR();
      if (typeof e === "object") {
        e.domainEmitter = this;
        ObjectDefineProperty(e, "domain", {
          __proto__: null,
          configurable: true,
          enumerable: false,
          value: self,
          writable: true,
        });
        e.domainThrown = false;
      }
      self.emit("error", e);
    };
  }

  add(emitter) {
    // Like node, an emitter belongs to at most one domain at a time.
    const previous = emitter.domain;
    if (previous != null && typeof previous.remove === "function") {
      previous.remove(emitter);
    }
    emitter.on("error", this[kEmitError]);
    ObjectDefineProperty(emitter, "domain", {
      __proto__: null,
      configurable: true,
      enumerable: false,
      value: this,
      writable: true,
    });
    this.members.push(emitter);
  }

  remove(emitter) {
    emitter.removeListener("error", this[kEmitError]);
    emitter.domain = null;
    const index = this.members.indexOf(emitter);
    if (index !== -1) {
      this.members.splice(index, 1);
    }
  }

  bind(fn) {
    const self = this;
    const emitError = this[kEmitError];
    // Like node: runs inside the domain, keeps this and args, returns the result.
    return function () {
      self.enter();
      try {
        return fn.$apply(this, arguments);
      } catch (err) {
        emitError(err);
      } finally {
        self.exit();
      }
    };
  }

  intercept(fn) {
    const self = this;
    const emitError = this[kEmitError];
    return function (err) {
      // Like node, only an Error first argument is routed. Anything else is dropped.
      if (err instanceof Error) {
        err.domainBound = fn;
        emitError(err);
        return;
      }
      var args = Array.prototype.slice.$call(arguments, 1);
      self.enter();
      try {
        return fn.$apply(this, args);
      } catch (err) {
        emitError(err);
      } finally {
        self.exit();
      }
    };
  }

  run(fn, ...args) {
    // Bare call like bind(): run()-thrown errors get no domainEmitter.
    const emitError = this[kEmitError];
    this.enter();
    try {
      return fn.$apply(this, args);
    } catch (err) {
      emitError(err);
    } finally {
      this.exit();
    }
  }

  dispose() {
    // Detach members first so a disposed domain no longer receives their errors.
    const members = this.members;
    while (members.length !== 0) {
      this.remove(members[members.length - 1]);
    }
    this.removeAllListeners();
    return this;
  }

  enter() {
    stack.push(this);
    setActive(this);
    return this;
  }

  exit() {
    const index = stack.lastIndexOf(this);
    if (index === -1) return this;
    stack.splice(index, stack.length);
    setActive(stack[stack.length - 1]);
    return this;
  }
}

function createDomain() {
  return new Domain();
}

const domain: any = {
  _stack: stack,
  Domain,
  createDomain,
  create: createDomain,
  active: null,
};

export default domain;
