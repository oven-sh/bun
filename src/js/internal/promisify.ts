const kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");
const kCustomPromisifyArgsSymbol = Symbol("customPromisifyArgs");

function defineCustomPromisify(target: Function, callback: Function) {
  Object.defineProperty(target, kCustomPromisifiedSymbol, {
    value: callback,
    writable: true,
    configurable: true,
  });
  return callback;
}

function defineCustomPromisifyArgs(target: Function, args: string[]) {
  Object.defineProperty(target, kCustomPromisifyArgsSymbol, {
    value: args,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return args;
}

function promisify(original: Function) {
  if (typeof original !== "function") throw new TypeError('The "original" argument must be of type Function');

  const custom = original[kCustomPromisifiedSymbol];
  if (custom) {
    if (typeof custom !== "function") {
      throw new TypeError('The "util.promisify.custom" argument must be of type Function');
    }
    return defineCustomPromisify(custom, custom);
  }

  const callbackArgs = original[kCustomPromisifyArgsSymbol];
  const isTimer = original === setTimeout || original === setInterval;

  if (isTimer) {
    function timerFn(timeout: number, ...rest: any[]) {
      return new Promise(resolve => {
        original.$apply(null, [() => resolve(rest[0]), timeout, ...rest]);
      });
    }
    Object.setPrototypeOf(timerFn, Object.getPrototypeOf(original));
    defineCustomPromisify(timerFn, timerFn);
    return Object.defineProperties(timerFn, Object.getOwnPropertyDescriptors(original));
  }

  function fn(this: unknown, ...args: any[]) {
    return new Promise((resolve, reject) => {
      original.$apply(this, [
        ...args,
        (err: Error | null, ...values: any[]) => {
          if (err) return reject(err);

          if (callbackArgs === undefined || values.length === 0) {
            resolve(values[0]);
            return;
          }

          if (!Array.isArray(callbackArgs)) {
            throw new TypeError('The "customPromisifyArgs" argument must be of type Array');
          }

          const result: Record<string, any> = {};
          const len = Math.min(callbackArgs.length, values.length);
          for (let i = 0; i < len; i++) {
            result[callbackArgs[i]] = values[i];
          }
          resolve(result);
        },
      ]);
    });
  }

  Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
  defineCustomPromisify(fn, fn);
  return Object.defineProperties(fn, Object.getOwnPropertyDescriptors(original));
}

Object.defineProperty(promisify, "custom", {
  value: kCustomPromisifiedSymbol,
  enumerable: true,
  configurable: true,
});

export default {
  defineCustomPromisify,
  defineCustomPromisifyArgs,
  promisify,
};
