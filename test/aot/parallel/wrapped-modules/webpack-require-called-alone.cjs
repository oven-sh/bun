// webpack's output whose require function is only called: no helper is stored on it, and no function of the entry names it.
var out = [];
(() => {
  var __webpack_modules__ = ({
    10: ((module, exports, __webpack_require__) => {
      const inner = __webpack_require__(20);
      const kept = new Map([["a", 1]]);
      exports.plusTwo = function (o, i) { return inner.plus(o, i) + kept.size; };
      exports.again = () => __webpack_require__(20) === inner;
      exports.late = () => __webpack_require__("./late.js").name;
      exports.missing = () => { try { return __webpack_require__("./missing.js"); } catch (error) { return error.constructor.name; } };
    }),
    20: ((module) => { out.push("20 runs"); module.exports = { plus: function (a, b) { return a + b; } }; }),
    "./late.js": ((__unused, exports, require) => { out.push("late runs"); exports.name = "late " + typeof require + " " + (require(10).again() && require.length); })
  });
  var __webpack_module_cache__ = {};
  function __webpack_require__(moduleId) {
    var cachedModule = __webpack_module_cache__[moduleId];
    if (cachedModule !== undefined) { return cachedModule.exports; }
    var module = __webpack_module_cache__[moduleId] = { exports: {} };
    __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
    return module.exports;
  }
  var __webpack_exports__ = __webpack_require__(10);
  module.exports = __webpack_exports__;
})();
let sum = 0;
for (let i = 0; i < 1000; i++) sum = (sum + module.exports.plusTwo(i, 2)) & 65535;
out.push(sum, module.exports.again(), module.exports.late(), module.exports.late(), module.exports.missing());
console.log(out.join("\n"));
