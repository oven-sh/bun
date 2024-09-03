// Hardcoded module "node:timers"
const { defineCustomPromisify } = require("internal/promisify");

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
  setTimeout,
  clearTimeout,
  setInterval,
  setImmediate,
  clearInterval,
  clearImmediate,
};
