// @module "node:timers"
// This implementation isn't 100% correct
// Ref/unref does not impact whether the process is kept alive

export var { setTimeout, clearTimeout, setInterval, setImmediate, clearInterval, clearImmediate } = globalThis;

export default {
  setInterval,
  setImmediate,
  setTimeout,
  clearInterval,
  clearTimeout,
  [Symbol.for("CommonJS")]: 0,
};
