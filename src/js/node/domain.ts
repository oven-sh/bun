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

  constructor() {
    super();
    this.members = [];
    const self = this;
    // A regular function so `this` is the emitter that emitted "error".
    this[kEmitError] = function emitError(e) {
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
    emitter.on("error", this[kEmitError]);
    emitter.domain = this;
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
    const emitError = this[kEmitError];
    return function () {
      var args = Array.prototype.slice.$call(arguments);
      try {
        fn.$apply(null, args);
      } catch (err) {
        emitError(err);
      }
    };
  }

  intercept(fn) {
    const emitError = this[kEmitError];
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
