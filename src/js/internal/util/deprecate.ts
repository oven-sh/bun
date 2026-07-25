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

// `modifyPrototype` mirrors node's internal deprecate() parameter of the same
// name, surfaced publicly as util.deprecate(fn, msg, code, { modifyPrototype }).
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util.js#L162
function deprecate(fn, msg, code, modifyPrototype = true) {
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

  // Bun compiles builtin modules such that function declarations get no own
  // "prototype" property; node's wrapper is a plain function declaration, so
  // give it the same default shape before applying node's prototype handling.
  Object.defineProperty(deprecated, "prototype", {
    __proto__: null,
    value: Object.defineProperty({}, "constructor", {
      __proto__: null,
      value: deprecated,
      writable: true,
      enumerable: false,
      configurable: true,
    }),
    writable: true,
    enumerable: false,
    configurable: false,
  });

  if (modifyPrototype) {
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
  }
  return deprecated;
}

export default {
  deprecate,
};
