const { validateString } = require("internal/validators");

const codesWarned = new Set<string>();

function getDeprecationWarningEmitter(
  code: string | undefined,
  msg: string,
  deprecated: (...args: unknown[]) => unknown,
  shouldEmitWarning = () => true,
) {
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

function deprecate<T extends abstract new (...args: never[]) => unknown>(fn: T, msg: string, code?: string): T;
function deprecate<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  msg: string,
  code?: string,
): (...args: Args) => Result;
function deprecate(fn: (this: unknown, ...args: unknown[]) => unknown, msg: string, code?: string) {
  // Lazy-load to avoid a circular dependency.
  if (code !== undefined) validateString(code, "code");

  const emitDeprecationWarning = getDeprecationWarningEmitter(code, msg, deprecated);

  function deprecated(this: unknown, ...args: unknown[]) {
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
