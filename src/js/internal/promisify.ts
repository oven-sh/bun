const { validateFunction } = require("internal/validators");

const ArrayPrototypePush = Array.prototype.push;

const kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");
const kCustomPromisifyArgsSymbol = Symbol("customPromisifyArgs");

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

function promisify(original) {
  validateFunction(original, "original");

  if (original[kCustomPromisifiedSymbol]) {
    const fn = original[kCustomPromisifiedSymbol];

    validateFunction(fn, "util.promisify.custom");

    Object.defineProperty(fn, kCustomPromisifiedSymbol, {
      __proto__: null,
      value: fn,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    Object.defineProperty(fn, "name", { value: original.name });
    return fn;
  }

  // Names to create an object from in case the callback receives multiple
  // arguments, e.g. ['bytesRead', 'buffer'] for fs.read.
  const argumentNames = original[kCustomPromisifyArgsSymbol];

  function fn(...args) {
    return new Promise((resolve, reject) => {
      ArrayPrototypePush.$call(args, (err, ...values) => {
        if (err) {
          return reject(err);
        }
        if (argumentNames !== undefined && values.length > 1) {
          const obj = {};
          for (let i = 0; i < argumentNames.length; i++) obj[argumentNames[i]] = values[i];
          resolve(obj);
        } else {
          resolve(values[0]);
        }
      });
      if ($isPromise(original.$apply(this, args))) {
        process.emitWarning(
          "Calling promisify on a function that returns a Promise is likely a mistake.",
          "DeprecationWarning",
          "DEP0174",
        );
      }
    });
  }

  Object.setPrototypeOf(fn, Object.getPrototypeOf(original));

  Object.defineProperty(fn, kCustomPromisifiedSymbol, {
    __proto__: null,
    value: fn,
    enumerable: false,
    writable: false,
    configurable: true,
  });

  const descriptors = Object.getOwnPropertyDescriptors(original);
  const propertiesValues = Object.values(descriptors);
  for (let i = 0; i < propertiesValues.length; i++) {
    // We want to use null-prototype objects to not rely on globally mutable
    // %Object.prototype%.
    Object.setPrototypeOf(propertiesValues[i], null);
  }
  Object.defineProperties(fn, descriptors);
  Object.defineProperty(fn, "name", { value: original.name });
  return fn;
}
promisify.custom = kCustomPromisifiedSymbol;

// Lazily load node:timers/promises promisified functions onto the global timers.
{
  const { setTimeout: timeout, setImmediate: immediate, setInterval: interval } = globalThis;

  if (timeout && $isCallable(timeout)) {
    defineCustomPromisify(timeout, function setTimeout(arg1) {
      const fn = defineCustomPromisify(timeout, require("node:timers/promises").setTimeout);
      return fn.$apply(this, arguments);
    });
  }

  if (immediate && $isCallable(immediate)) {
    defineCustomPromisify(immediate, function setImmediate(arg1) {
      const fn = defineCustomPromisify(immediate, require("node:timers/promises").setImmediate);
      return fn.$apply(this, arguments);
    });
  }

  if (interval && $isCallable(interval)) {
    defineCustomPromisify(interval, function setInterval(arg1) {
      const fn = defineCustomPromisify(interval, require("node:timers/promises").setInterval);
      return fn.$apply(this, arguments);
    });
  }
}

export default {
  defineCustomPromisify,
  defineCustomPromisifyArgs,
  promisify,
};
