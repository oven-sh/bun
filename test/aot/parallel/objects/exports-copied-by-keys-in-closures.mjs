// The same, captured by a closure that is never called.
var commonjs = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var core = commonjs(function (exports) {
  function step() {}
  exports.step = step;
});
var dom = commonjs(function (exports) {
  var inner = core();
  Object.keys(inner).forEach(function (key) {
    exports[key] = inner[key];
  });
});
var ssr = function () {
  var outer = dom();
  var first = outer.step;
  function compile() {
    outer.transform({ steps: [first] });
  }
};
ssr();
console.log("end");
