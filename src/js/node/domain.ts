// Import Events
let EventEmitter;

const ObjectDefineProperty = Object.defineProperty;

// Export Domain
var domain: any = {};
domain.createDomain = domain.create = function create() {
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
        value: domain,
        writable: true,
      });
      e.domainThrown = false;
    }
    d.emit("error", e);
  }

  d.add = function add(emitter) {
    emitter.on("error", emitError);
  };
  d.remove = function remove(emitter) {
    emitter.removeListener("error", emitError);
  };
  d.bind = function bind(fn) {
    return function () {
      var args = Array.prototype.slice.$call(arguments);
      try {
        fn.$apply(null, args);
      } catch (err) {
        emitError(err);
      }
    };
  };
  d.intercept = function intercept(fn) {
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
  d.run = function run(fn) {
    try {
      fn();
    } catch (err) {
      emitError(err);
    }
    return this;
  };
  d.dispose = function dispose() {
    this.removeAllListeners();
    return this;
  };
  d.enter = function enter() {
    return this;
  };
  d.exit = function exit() {
    return this;
  };
  return d;
};
export default domain;
