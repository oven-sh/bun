import {
__require as require
} from "http://localhost:8080/bun:runtime";
import {
__HMRModule as HMR
} from "http://localhost:8080/bun:runtime";
import {
__HMRClient as Bun
} from "http://localhost:8080/bun:runtime";
import * as $bbcd215f from "http://localhost:8080/node_modules/react/index.js";
Bun.activate(false);

var hmr = new HMR(3012834585, "bundled-entry-point.js"), exports = hmr.exports;
(hmr._load = function() {
  var hello = null ?? "world";
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
