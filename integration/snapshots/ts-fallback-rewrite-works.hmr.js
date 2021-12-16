import {
__HMRModule as HMR
} from "http://localhost:3000/__runtime.js";
import {
__HMRClient as Bun
} from "http://localhost:3000/__runtime.js";
Bun.activate(true);

var hmr = new HMR(421762902, "ts-fallback-rewrite-works.ts"), exports = hmr.exports;
(hmr._load = function() {
  function test() {
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    test: () => test
  });
})();
var $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_test = exports.test;
};

export {
  $$hmr_test as test
};
