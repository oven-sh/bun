const kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");
const { validateFunction } = require("internal/validators");
const { kCustomPromisifyArgsSymbol } = require("internal/shared");

function defineCustomPromisify(target, callback) {
  Object.defineProperty(target, kCustomPromisifiedSymbol, {
    value: callback,
    configurable: true,
  });

  return callback;
}

function defineCustomPromisifyArgs(target, args) {
  Object.defineProperty(target, kCustomPromisifyArgsSymbol, {
    value: args,
    enumerable: false,
  });
  return args;
}

interface Promisify {
  (original: any): any;
  custom: typeof kCustomPromisifiedSymbol;
}

var promisify = function promisify(original) {
  validateFunction(original, "original");
  const custom = original[kCustomPromisifiedSymbol];
  if (custom) {
    validateFunction(custom, "custom");
    // ensure that we don't create another promisified function wrapper
    return defineCustomPromisify(custom, custom);
  }

  const callbackArgs = original[kCustomPromisifyArgsSymbol];
  function fn(...originalArgs) {
    const promise = $newPromise();
    try {
      $arrayPush(
        originalArgs,
        callbackArgs === undefined
          ? function (err, value = undefined) {
              if (err) {
                $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, err);
              } else {
                $resolvePromiseWithFirstResolvingFunctionCallCheck(promise, value);
              }
            }
          : function (err, ...values) {
              if (err) {
                $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, err);
                return;
              }
              const result = {};
              for (let i = 0; i < callbackArgs.length; i++) {
                result[callbackArgs[i]] = values[i];
              }
              $resolvePromiseWithFirstResolvingFunctionCallCheck(promise, result);
            },
      );
      const maybePromise = original.$apply(this, originalArgs);

      if ($isPromise(maybePromise)) {
        process.emitWarning(
          "Calling promisify on a function that returns a Promise is likely a mistake.",
          "DeprecationWarning",
          "DEP0174",
        );
      }
    } catch (err) {
      $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, err);
    }

    return promise;
  }
  Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
  defineCustomPromisify(fn, fn);
  return Object.defineProperties(fn, Object.getOwnPropertyDescriptors(original));
} as Promisify;
promisify.custom = kCustomPromisifiedSymbol;

export default {
  defineCustomPromisifyArgs,
  promisify,
};
