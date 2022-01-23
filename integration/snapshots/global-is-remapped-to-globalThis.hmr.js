import {
__HMRModule as HMR
} from "http://localhost:8080/bun:wrap";
import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(false);

var hmr = new HMR(713665787, "global-is-remapped-to-globalThis.js"), exports = hmr.exports;
(hmr._load = function() {
  function test() {
    console.assert(globalThis === globalThis);
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
