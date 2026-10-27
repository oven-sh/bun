const { validateString } = require("internal/validators");

const codesWarned = new Set();

function getDeprecationWarningEmitter(code, msg, deprecated, shouldEmitWarning = () => true) {
  let warned = false;
  return function () {
    if (!warned && shouldEmitWarning()) {
      warned = true;
      if (code !== undefined) {
        if (!codesWarned.has(code)) {
          process.emitWarning(msg, "DeprecationWarning", code, deprecated);
          codesWarned.add(code);
        }
      } else {
        process.emitWarning(msg, "DeprecationWarning", deprecated);
      }
    }
  };
}

function deprecate(fn, msg, code) {
  // Lazy-load to avoid a circular dependency.
  if (code !== undefined) validateString(code, "code");

  const emitDeprecationWarning = getDeprecationWarningEmitter(code, msg, deprecated);

  function deprecated(...args) {
    if (!process.noDeprecation) {
      emitDeprecationWarning();
    }
    if (new.target) {
      return Reflect.construct(fn, args, new.target);
    }
    return fn.$apply(this, args);
  }

  // The wrapper will keep the same prototype as fn to maintain prototype chain
  Object.setPrototypeOf(deprecated, fn);
  const fnPrototype = fn.prototype;
  if (fnPrototype) {
    // Sharing fn.prototype makes instanceof work across the wrapper. Use defineProperty:
    // builtin-compiled wrappers lack an own "prototype", so a plain assignment would hit
    // fn's non-writable "prototype" through the prototype chain.
    Object.defineProperty(deprecated, "prototype", {
      __proto__: null,
      value: fnPrototype,
      writable: true,
    });
  }
  Object.defineProperty(deprecated, "length", {
    __proto__: null,
    ...Object.getOwnPropertyDescriptor(fn, "length"),
  });
  return deprecated;
}

export default {
  deprecate,
};
