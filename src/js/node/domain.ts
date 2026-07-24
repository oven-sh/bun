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
    function runBound() {
      d.enter();
      try {
        return fn.$apply(this, arguments);
      } catch (err) {
        emitError(err);
      } finally {
        d.exit();
      }
    }
    ObjectDefineProperty(runBound, "domain", {
      __proto__: null,
      configurable: true,
      enumerable: false,
      value: d,
      writable: true,
    });
    return runBound;
  };
  d.intercept = function (fn) {
    return function runIntercepted() {
      var er = arguments[0];
      if (er && er instanceof Error) {
        er.domainBound = fn;
        er.domainThrown = false;
        ObjectDefineProperty(er, "domain", {
          __proto__: null,
          configurable: true,
          enumerable: false,
          value: d,
          writable: true,
        });
        d.emit("error", er);
        return;
      }
      var args = Array.prototype.slice.$call(arguments, 1);
      d.enter();
      try {
        return fn.$apply(this, args);
      } catch (err) {
        emitError(err);
      } finally {
        d.exit();
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
  return d;
};

// Domains entered via enter()/run() and not yet exited, innermost last.
// process.domain mirrors the top of the stack like in node so other modules
// can observe the currently active domain.
const stack: any[] = [];
domain._stack = stack;
domain.active = null;

export default domain;
