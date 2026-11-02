// A `__commonJS` that forgets its module when the method throws: the next call makes a new module and runs the method again.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var runs = 0;
var require_bad = __commonJS({
  "bad.js"(exports) {
    runs++;
    exports.partial = runs;
    if (runs < 2) throw new Error("no");
  }
});
var attempt = () => {
  try {
    return JSON.stringify(require_bad());
  } catch (error) {
    return error.message;
  }
};
console.log(attempt(), attempt(), attempt(), runs);
