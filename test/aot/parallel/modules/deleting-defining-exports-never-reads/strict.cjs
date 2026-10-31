"use strict";
const attempt = f => {
  try {
    return String(f());
  } catch (e) {
    return e.constructor.name;
  }
};
exports.ask = function () {
  const t = require("./required-by-strict-code.mjs");
  return [
    attempt(() => delete t.a1),
    attempt(() => delete t["a2"]),
    attempt(() => Reflect.deleteProperty(t, "a3")),
    attempt(() => Reflect.defineProperty(t, "a4", {})),
    attempt(() => Reflect.defineProperty(t, "a5", { value: 5 })),
    attempt(() => Reflect.defineProperty(t, "a6", { value: 7 })),
    attempt(() => Object.defineProperty(t, "a7", { value: 7 }) === t),
    attempt(() => delete t.missing),
    attempt(() => Reflect.deleteProperty(t, "missing")),
    attempt(() => Reflect.defineProperty(t, "missing", {})),
    attempt(() => Reflect.deleteProperty(t, Symbol.toStringTag)),
    attempt(() => t.used()),
  ].join(" ");
};
