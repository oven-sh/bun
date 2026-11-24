// A field of exports that a loop over the keys of other exports filled, captured by a closure.
var commonjs = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var core = commonjs(function (exports) {
  function step() { return 7; }
  exports.step = step;
  exports.other = 5;
});
var dom = commonjs(function (exports) {
  var inner = core();
  Object.keys(inner).forEach(function (key) {
    exports[key] = inner[key];
  });
});
function ssr() {
  var outer = dom();
  var first = outer.step, second = outer.other;
  function compile() {
    return [first, second];
  }
  return [typeof first, typeof second, outer.step === undefined, compile().length];
}
console.log(ssr(), ssr());
