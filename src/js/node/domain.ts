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
  // No try/catch, and no exit() on the throwing path: node lets the exception
  // reach the fatal-exception handler with the domain still entered, which is
  // how `process.domain` is still set when the error is finally routed.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/domain.js#L371
  d.run = function (fn, ...args) {
    this.enter();
    const ret = fn.$apply(this, args);
    this.exit();
    return ret;
  };
  // Port of Domain.prototype._errorHandler.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/domain.js#L222
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

    // Pop all adjacent duplicates of this domain so its 'error' handler does
    // not run inside itself and re-enter on a throw.
    while (domain.active === d) {
      d.exit();
    }

    if (stack.length === 0) {
      if (d.listenerCount("error") > 0) {
        caught = d.emit("error", er);
      }
    } else {
      try {
        caught = d.emit("error", er);
      } catch (er2) {
        // The handler threw: offer the new error to the next domain down, or
        // let it become the uncaught exception.
        if (stack.length) {
          domain.active = process.domain = stack[stack.length - 1];
          caught = domain.active._errorHandler(er2);
        } else {
          throw er2;
        }
      }
    }

    // Uncaught exceptions end the tick; no domain may stay on the stack.
    stack.length = 0;
    domain.active = process.domain = null;
    return caught;
  };
  d.dispose = function () {
    this.removeAllListeners();
    return this;
  };
  d.enter = function () {
    ensureDomainExceptionCapture();
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

let domainExceptionCaptureInstalled = false;
function domainFatalExceptionHandler(er) {
  const active = domain.active;
  return active != null && active._errorHandler(er);
}

// Errors thrown out of a domain reach the process's fatal-exception handler
// with the domain still entered; route them to its 'error' listeners the way
// node's domain module does.
function ensureDomainExceptionCapture() {
  if (domainExceptionCaptureInstalled) return;
  domainExceptionCaptureInstalled = true;
  require("internal/uncaught_exception_capture").addUncaughtExceptionCaptureCallback(domainFatalExceptionHandler);
}

// Domains entered via enter()/run() and not yet exited, innermost last.
// process.domain mirrors the top of the stack like in node so other modules
// can observe the currently active domain.
const stack: any[] = [];
domain._stack = stack;
domain.active = null;

export default domain;
