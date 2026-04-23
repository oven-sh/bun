// Import Events
let EventEmitter;

const ObjectDefineProperty = Object.defineProperty;

// Domain stack for tracking nested domains
const _stack: any[] = [];

// Export Domain
var domain: any = {};
domain._stack = _stack;
domain.active = null;
domain.createDomain = domain.create = function () {
  if (!EventEmitter) {
    EventEmitter = require("node:events");
  }
  var d = new EventEmitter();
  d.members = [];

  function emitError(e, thrown?) {
    if (!e) e = $ERR_UNHANDLED_ERROR();
    if ((typeof e === "object" && e !== null) || typeof e === "function") {
      if (this != null) e.domainEmitter = this;
      ObjectDefineProperty(e, "domain", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: d,
        writable: true,
      });
      e.domainThrown = thrown === true;
    }
    d.emit("error", e);
  }

  d.add = function (emitter) {
    if (emitter.domain === d) {
      return;
    }
    if (emitter.domain && emitter.domain !== d && typeof emitter.domain.remove === "function") {
      emitter.domain.remove(emitter);
    }
    emitter.on("error", emitError);
    emitter.domain = d;
    d.members.push(emitter);
  };
  d.remove = function (emitter) {
    emitter.removeListener("error", emitError);
    if (emitter.domain === d) {
      emitter.domain = null;
    }
    var index = d.members.indexOf(emitter);
    if (index !== -1) {
      d.members.splice(index, 1);
    }
  };
  d.bind = function (fn) {
    return function () {
      var args = Array.prototype.slice.$call(arguments);
      try {
        return fn.$apply(this, args);
      } catch (err) {
        emitError.$call(d, err, true);
      }
    };
  };
  d.intercept = function (fn) {
    return function (err) {
      if (err) {
        emitError.$call(d, err);
      } else {
        var args = Array.prototype.slice.$call(arguments, 1);
        try {
          return fn.$apply(this, args);
        } catch (err) {
          emitError.$call(d, err, true);
        }
      }
    };
  };
  d.enter = function () {
    _stack.push(d);
    domain.active = d;
    process.domain = d;
    return this;
  };
  d.exit = function () {
    var index = _stack.lastIndexOf(d);
    if (index !== -1) {
      _stack.splice(index);
    }
    var prev = _stack.length > 0 ? _stack[_stack.length - 1] : null;
    domain.active = prev;
    process.domain = prev;
    return this;
  };
  d.run = function (fn) {
    d.enter();
    try {
      fn();
    } catch (err) {
      emitError.$call(d, err, true);
    } finally {
      d.exit();
    }
    return this;
  };
  d.dispose = function () {
    var members = Array.prototype.slice.$call(this.members);
    for (var i = 0; i < members.length; i++) {
      d.remove(members[i]);
    }
    this.removeAllListeners();
    d.exit();
    return this;
  };
  return d;
};
export default domain;
