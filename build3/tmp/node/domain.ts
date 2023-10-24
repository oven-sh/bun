// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/domain.ts


// Import Events
var EventEmitter = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 20/*node:events*/) || __intrinsic__createInternalModuleById(20/*node:events*/));

// Export Domain
var domain: any = {};
domain.createDomain = domain.create = function () {
  var d = new EventEmitter();

  function emitError(e) {
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
      var args = Array.prototype.slice.__intrinsic__call(arguments);
      try {
        fn.__intrinsic__apply(null, args);
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
        var args = Array.prototype.slice.__intrinsic__call(arguments, 1);
        try {
          fn.__intrinsic__apply(null, args);
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
$$EXPORT$$(domain).$$EXPORT_END$$;
