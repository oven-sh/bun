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

var hmr = new FastHMR(2883558553, "multiple-var.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  var foo = true;
  globalThis.TRUE_BUT_WE_CANT_TREESHAKE_IT = true;
  if (globalThis.TRUE_BUT_WE_CANT_TREESHAKE_IT)
    ({
      foo
    } = {foo: false });
  function test() {
    console.assert(foo === false, "foo should be false");
    return testDone(import.meta.url);
  }
  var foo;
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
