import {
__HMRModule as HMR
} from "http://localhost:8080/__runtime.js";
import {
__HMRClient as Bun
} from "http://localhost:8080/__runtime.js";
Bun.activate(false);

var hmr = new HMR(1398361736, "unicode-identifiers.js"), exports = hmr.exports;
(hmr._load = function() {
  var ε = 1.0e-06, ε2 = ε * ε, π = Math.PI, τ = 2 * π, τε = τ - ε, halfπ = π / 2, d3_radians = π / 180, d3_degrees = 180 / π;
  function test() {
    console.assert(ε === 1.0e-06);
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    d3_radians: () => d3_radians,
    test: () => test
  });
})();
var $$hmr_d3_radians = hmr.exports.d3_radians, $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_d3_radians = exports.d3_radians;
  $$hmr_test = exports.test;
};

export {
  $$hmr_d3_radians as d3_radians,
  $$hmr_test as test
};
