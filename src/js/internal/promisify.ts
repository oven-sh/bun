const kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");
const kCustomPromisifyArgsSymbol = Symbol("customPromisifyArgs");

function defineCustomPromisify(target, callback) {
  Object.defineProperty(target, kCustomPromisifiedSymbol, {
    value: callback,
    __proto__: null,
    configurable: true,
  });

  return callback;
}

function defineCustomPromisifyArgs(target, args) {
  Object.defineProperty(target, kCustomPromisifyArgsSymbol, {
    __proto__: null,
    value: args,
    enumerable: false,
  });
  return args;
}

var promisify = function promisify(original) {
  if (typeof original !== "function") throw new TypeError('The "original" argument must be of type Function');
  const custom = original[kCustomPromisifiedSymbol];
  if (custom) {
    if (typeof custom !== "function") {
      throw new TypeError('The "util.promisify.custom" argument must be of type Function');
    }
    // ensure that we don't create another promisified function wrapper
    return defineCustomPromisify(custom, custom);
  }

  const callbackArgs = original[kCustomPromisifyArgsSymbol];

  function fn(...originalArgs) {
    const { promise, resolve, reject } = Promise.withResolvers();
    try {
      original.$apply(this, [
        ...originalArgs,
        function (err, ...values) {
          if (err) {
            return reject(err);
          }

          if (callbackArgs !== undefined && values.length > 0) {
            if (!Array.isArray(callbackArgs)) {
              throw new TypeError('The "customPromisifyArgs" argument must be of type Array');
            }
            if (callbackArgs.length !== values.length) {
              throw new Error("Mismatched length in promisify callback args");
            }
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
  defineCustomPromisify,
  defineCustomPromisifyArgs,
  promisify,
};
