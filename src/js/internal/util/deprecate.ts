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
  return deprecated;
}

export default {
  deprecate,
};
