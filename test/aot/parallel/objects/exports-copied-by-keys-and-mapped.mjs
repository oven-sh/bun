// The same, passed to the callback of a map.
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
function ssr() { var outer = dom(); const f = outer.step; console.log([f, outer.other].map(x => typeof x).join()); }
ssr(); ssr();
