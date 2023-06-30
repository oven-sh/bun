var { setTimeout, clearTimeout, setInterval, setImmediate, clearInterval, clearImmediate } = globalThis, timers_default = {
  setInterval,
  setImmediate,
  setTimeout,
  clearInterval,
  clearTimeout,
  [Symbol.for("CommonJS")]: 0
};
export {
  setTimeout,
  setInterval,
  setImmediate,
  timers_default as default,
  clearTimeout,
  clearInterval,
  clearImmediate
};
