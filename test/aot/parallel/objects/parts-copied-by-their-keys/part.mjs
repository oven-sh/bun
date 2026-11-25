const wrap = (make, held) => () => (held || make((held = { exports: {} }).exports, held), held.exports);
const first = wrap(function (exports) {
  exports.step = function step() {
    return 7;
  };
  exports.other = 5;
});
const second = wrap(function (exports) {
  const inner = first();
  Object.keys(inner).forEach(function (key) {
    exports[key] = inner[key];
  });
});
const third = wrap(function (exports) {
  Object.entries(second()).map(function ([key, value]) {
    exports[key + "s"] = value;
  });
});
const unused = wrap(function (exports) {
  Object.keys(second()).findLast(function (key) {
    exports[key] = 1;
  });
});
console.log(typeof second().step, second().other, third().others);
export const total = Object.keys(third()).length;
