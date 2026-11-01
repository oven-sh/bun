var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var require_first = __commonJS({
  "src/first.js"(exports, module) {
    module.exports = { first: 1 };
  }
});
var require_second = __commonJS({
  "src/second.js"(exports, module) {
    module.exports = { second: require_first().first + 1 };
  }
});
export const both = { ...require_first(), ...require_second() };
export function late() { return require_second().second; }
