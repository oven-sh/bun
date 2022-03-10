import {
__HMRClient as Bun
} from "http://localhost:3000/bun:wrap";
import {
__FastRefreshModule as FastHMR
} from "http://localhost:3000/bun:wrap";
import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:3000/bun:wrap";
import pkg from "http://localhost:3000/utf8-package-json.json";
Bun.activate(true);

var hmr = new FastHMR(4111115104, "package-json-utf8.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  function test() {
    console.assert(!!pkg.author);
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

//# sourceMappingURL=http://localhost:3000/package-json-utf8.js.map
