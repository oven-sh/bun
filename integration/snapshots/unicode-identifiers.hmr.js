import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshModule as FastHMR
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:8080/bun:wrap";
Bun.activate(false);

var hmr = new FastHMR(1398361736, "unicode-identifiers.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  var ε = 0.000001, ε2 = ε * ε, π = Math.PI, τ = 2 * π, τε = τ - ε, halfπ = π / 2, d3_radians = π / 180, d3_degrees = 180 / π;
  function test() {
    console.assert(ε === 0.000001);
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
