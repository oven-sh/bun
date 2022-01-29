import {
__HMRModule as HMR
} from "http://localhost:3000/bun:wrap";
import {
__HMRClient as Bun
} from "http://localhost:3000/bun:wrap";
Bun.activate(true);

var hmr = new HMR(2117426367, "tsx-fallback-rewrite-works.tsx"), exports = hmr.exports;
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
