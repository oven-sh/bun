// Import Events
let EventEmitter: typeof import("./events").default | undefined;

const ObjectDefineProperty = Object.defineProperty;

type AnyFunction = (...args: any[]) => unknown;

declare global {
  namespace $Node {
    interface Domain extends EventEmitter {
      add(emitter: EventEmitter): void;
      remove(emitter: EventEmitter): void;
      bind(fn: AnyFunction): () => void;
      intercept(fn: AnyFunction): (err?: unknown) => void;
      run(fn: AnyFunction, ...args: unknown[]): unknown;
      dispose(): this;
      enter(): this;
      exit(): this;
    }
  }
}

interface DomainError extends Error {
  domainEmitter?: unknown;
  domainThrown?: boolean;
}

interface DomainModule {
  createDomain(): $Node.Domain;
  create(): $Node.Domain;
  _stack: $Node.Domain[];
  active: $Node.Domain | null;
}

// Export Domain
var domain = {} as DomainModule;
domain.createDomain = domain.create = function () {
  if (!EventEmitter) {
    EventEmitter = require("node:events");
  }
  var d = new EventEmitter!() as $Node.Domain;

  function emitError(this: unknown, e?: unknown) {
    e ||= $ERR_UNHANDLED_ERROR();
    if (typeof e === "object") {
      (e as DomainError).domainEmitter = this;
      ObjectDefineProperty(e, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: d,
        writable: true,
      });
      (e as DomainError).domainThrown = false;
    }
    d.emit("error", e);
  }

  d.add = function (emitter: $Node.EventEmitter) {
    emitter.on("error", emitError);
  };
  d.remove = function (emitter: $Node.EventEmitter) {
    emitter.removeListener("error", emitError);
  };
  d.bind = function (fn: AnyFunction) {
    return function () {
      var args = Array.prototype.slice.$call(arguments);
      try {
        fn.$apply(null, args);
      } catch (err) {
        emitError(err);
      }
    };
  };
  d.intercept = function (fn: AnyFunction) {
    return function (err?: unknown) {
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
  d.run = function (this: $Node.Domain, fn: AnyFunction, ...args: unknown[]) {
    this.enter();
    try {
      return fn.$apply(this, args);
    } catch (err) {
      emitError(err);
    } finally {
      this.exit();
    }
  };
  d.dispose = function (this: $Node.Domain) {
    this.removeAllListeners();
    return this;
  };
  d.enter = function (this: $Node.Domain) {
    stack.push(this);
    domain.active = process.domain = this;
    return this;
  };
  d.exit = function (this: $Node.Domain) {
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
const stack: $Node.Domain[] = [];
domain._stack = stack;
domain.active = null;

export default domain;
