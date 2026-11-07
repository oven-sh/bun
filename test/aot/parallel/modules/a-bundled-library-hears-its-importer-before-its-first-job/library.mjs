// @bun
// What `bun build --format=esm --target=bun` makes of an ES file that requires a CommonJS file, formatted.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// defaults.cjs
var require_defaults = __commonJS(function (exports, module) {
  module.exports = { level: "default" };
});

// index.js
var defaults = require_defaults();
var level = defaults.level;
var listeners = [];
function configure(value) {
  level = value;
}
function onReady(f) {
  listeners.push(f);
}
var options = { retries: 1 };
var seen = (async () => {
  await null;
  return options.retries;
})();
queueMicrotask(() => {
  console.log("the library starts with", level, "and", listeners.length, "listeners");
  for (const f of listeners) f();
});
export { seen, options, onReady, configure };
