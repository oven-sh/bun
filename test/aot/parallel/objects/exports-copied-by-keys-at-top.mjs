// The same, captured at the top of a file.
var commonjs = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var core = commonjs(function (exports) {
  function step() { return 7; }
  exports.step = step;
  exports.other = 5;
  exports.text = "text";
});
var dom = commonjs(function (exports) {
  var inner = core();
  Object.keys(inner).forEach(function (key) {
    exports[key] = inner[key];
  });
});
const outer = dom(); const n = outer.other; const later = () => n; const g = [later]; console.log(g[0]() | 0);
