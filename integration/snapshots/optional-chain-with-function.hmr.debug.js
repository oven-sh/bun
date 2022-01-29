import {
__HMRModule as HMR
} from "http://localhost:8080/bun:wrap";
import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(true);

var hmr = new HMR(3608848620, "optional-chain-with-function.js"), exports = hmr.exports;
(hmr._load = function() {
  function test() {
    try {
      const multipleSecondaryValues = undefined;
      const ratings = ["123"];
      var bar = multipleSecondaryValues?.map((value) => false);
      bar = bar?.multipleSecondaryValues?.map((value) => false);
      bar = bar?.bar?.multipleSecondaryValues?.map((value) => false);
      bar = {}?.bar?.multipleSecondaryValues?.map((value) => false);
    } catch (e) {
      throw e;
    }
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
