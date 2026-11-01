// Bun's `__commonJS`: a callback that threw is not run again, and later calls answer the exports as far as they had got. A wrapper that is called later and calls the failed one at its top gets them too.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var runs = 0;
var require_bad = __commonJS((exports) => {
  runs++;
  exports.partial = runs;
  throw new Error("no");
});
var require_later = __commonJS((exports) => {
  exports.a = require_bad().partial;
});
var attempt = () => {
  try {
    return JSON.stringify(require_bad());
  } catch (error) {
    return error.message;
  }
};
console.log(attempt(), attempt(), attempt(), runs);
console.log(require_later().a);
