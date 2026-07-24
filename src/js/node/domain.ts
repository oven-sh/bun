// Import Events
let EventEmitter;

const ObjectDefineProperty = Object.defineProperty;

// Export Domain
var domain: any = {};
domain.createDomain = domain.create = function () {
  if (!EventEmitter) {
    EventEmitter = require("node:events");
  }
  var d = new EventEmitter();

  function emitError(e) {
    e ||= $ERR_UNHANDLED_ERROR();
    if (typeof e === "object") {
      e.domainEmitter = this;
      ObjectDefineProperty(e, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: d,
        writable: true,
      });
      e.domainThrown = false;
    }
    d.emit("error", e);
  }

  d.add = function (emitter) {
    emitter.on("error", emitError);
  };
  d.remove = function (emitter) {
    emitter.removeListener("error", emitError);
  };
  d.bind = function (fn) {
    return function () {
      var args = Array.prototype.slice.$call(arguments);
      try {
        fn.$apply(null, args);
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
        var args = Array.prototype.slice.$call(arguments, 1);
        try {
          fn.$apply(null, args);
        } catch (err) {
          emitError(err);
        }
      }
    };
  };
  d.run = function (fn, ...args) {
    this.enter();
    try {
      return fn.$apply(this, args);
    } catch (err) {
      emitError(err);
    } finally {
      this.exit();
    }
  };
  d.dispose = function () {
    this.removeAllListeners();
    return this;
  };
  d.enter = function () {
    stack.push(this);
    domain.active = process.domain = this;
    return this;
  };
  d.exit = function () {
    const index = stack.lastIndexOf(this);
    if (index === -1) return this;
    stack.splice(index, stack.length);
    domain.active = process.domain = stack.length ? stack[stack.length - 1] : null;
    return this;
  };
  // Routes an exception thrown by an async callback that ran inside this
  // domain, like Node's Domain.prototype._errorHandler: decorate the error,
  // emit 'error' (never on a handlerless top-level domain, so the process
  // still gets its uncaughtException), and clear the domain stack because the
  // throw ended this tick. Returns whether a handler caught the error.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/domain.js#L219
  d._errorHandler = function (er) {
    let caught = false;

    if ((typeof er === "object" && er !== null) || typeof er === "function") {
      ObjectDefineProperty(er, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: d,
        writable: true,
      });
      er.domainThrown = true;
    }

    if (stack.length === 1) {
      if (d.listenerCount("error") > 0) {
        caught = d.emit("error", er);
      }
    } else {
      try {
        caught = d.emit("error", er);
      } catch (er2) {
        // The domain error handler threw: see if an outer domain catches it.
        stack.pop();
        if (stack.length) {
          domain.active = process.domain = stack[stack.length - 1];
          caught = process.domain._errorHandler(er2);
        } else {
          throw er2;
        }
      }
    }

    // Uncaught exceptions end the current tick; no domains stay entered
    // between ticks.
    stack.length = 0;
    domain.active = process.domain = null;

    return caught;
  };
  return d;
};

// Domains entered via enter()/run() and not yet exited, innermost last.
// process.domain mirrors the top of the stack like in node so other modules
// can observe the currently active domain.
const stack: any[] = [];
domain._stack = stack;
domain.active = null;

export default domain;
