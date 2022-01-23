import {
__HMRModule as HMR
} from "http://localhost:8080/bun:wrap";
import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(false);

var hmr = new HMR(346837007, "forbid-in-is-correct.js"), exports = hmr.exports;
(hmr._load = function() {
  var foo = () => {
    var D = (i, r) => () => (r || i((r = {exports: {} }).exports, r), r.exports);
    return D;
  };
  function test() {
    foo();
    testDone(import.meta.url);
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
