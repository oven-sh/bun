// @bun
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// inner.cjs
var require_inner = __commonJS(function (exports, module) {
  module.exports = 7;
});

// owner.mjs
var inner = require_inner();
var x = inner;
Promise.resolve().then(() => console.log("a job of owner.mjs"));

export { x };
