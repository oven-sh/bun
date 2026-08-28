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
    const { promise, resolve, reject } = Promise.withResolvers();
    try {
      const maybePromise = original.$apply(this, [
        ...originalArgs,
        function (err, ...values) {
          if (err) {
            return reject(err);
          }

          if (callbackArgs !== undefined) {
            const result = {};
            for (let i = 0; i < callbackArgs.length; i++) {
              result[callbackArgs[i]] = values[i];
            }
            resolve(result);
          } else {
            resolve(values[0]);
          }
        },
      ]);

      if ($isPromise(maybePromise)) {
        process.emitWarning(
          "Calling promisify on a function that returns a Promise is likely a mistake.",
          "DeprecationWarning",
          "DEP0174",
        );
      }
    } catch (err) {
      reject(err);
    }

    return promise;
  }
  Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
  defineCustomPromisify(fn, fn);
  return Object.defineProperties(fn, Object.getOwnPropertyDescriptors(original));
};
promisify.custom = kCustomPromisifiedSymbol;

export default {
  defineCustomPromisifyArgs,
  promisify,
};
