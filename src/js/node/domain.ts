// Import Events
var EventEmitter = require("node:events");
const { ERR_UNHANDLED_ERROR } = require("internal/errors");

const ObjectDefineProperty = Object.defineProperty;

// Export Domain
var domain: any = {};
domain.createDomain = domain.create = function () {
  var d = new EventEmitter();

  function emitError(e) {
    e ||= ERR_UNHANDLED_ERROR();
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
  d.run = function (fn) {
    try {
      fn();
    } catch (err) {
      emitError(err);
    }
    return this;
  };
  d.dispose = function () {
    this.removeAllListeners();
    return this;
  };
  d.enter = d.exit = function () {
    return this;
  };
  return d;
};
export default domain;
