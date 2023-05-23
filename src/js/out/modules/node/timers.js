// src/js/node/timers.js
var { setTimeout, clearTimeout, setInterval, setImmediate, clearInterval, clearImmediate } = globalThis;
var timers_default = {
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

//# debugId=8AC5DDEBCD87CFD264756e2164756e21
