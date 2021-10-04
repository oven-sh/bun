import {
__HMRModule as HMR
} from "http://localhost:8080/__runtime.js";
import {
__HMRClient as Bun
} from "http://localhost:8080/__runtime.js";
Bun.activate(false);

var hmr = new HMR(1142302163, "code-simplification-neql-define.js"), exports = hmr.exports;
(hmr._load = function() {
  var testFailed = false;
  const invariant = () => {
    testFailed = true;
  };
  var $$m = (arg) => {
    var module = {exports: {} }, exports = module.exports;
    return arg(module, exports);
  };
  var size = 100, ttl = 3600;
  var $f332019d = $$m({
    "relay-runtime/lib/network/RelayQueryResponseCache.js": (module, exports) => {
      var RelayQueryResponseCache = function() {
        var foo = function RelayQueryResponseCache(_ref) {
          var size = _ref.size, ttl = _ref.ttl;
          !(size > 0) && invariant(false, "RelayQueryResponseCache: Expected the max cache size to be > 0, got " + "`%s`.", size);
          !(ttl > 0) && invariant(false, "RelayQueryResponseCache: Expected the max ttl to be > 0, got `%s`.", ttl);
        };
        foo({size: 100, ttl: 3600 });
      };
      RelayQueryResponseCache();
    }
  }["relay-runtime/lib/network/RelayQueryResponseCache.js"]);
  function test() {
    var foo = () => result;
    if (testFailed)
      throw new Error("invariant should not be called");
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    $f332019d: () => $f332019d,
    test: () => test
  });
})();
var $$hmr_$f332019d = hmr.exports.$f332019d, $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_$f332019d = exports.$f332019d;
  $$hmr_test = exports.test;
};

export {
  $$hmr_$f332019d as $f332019d,
  $$hmr_test as test
};
