import {
__require as require
} from "http://localhost:8080/__runtime.js";
import {
__HMRModule as HMR
} from "http://localhost:8080/__runtime.js";
import {
__HMRClient as Bun
} from "http://localhost:8080/__runtime.js";
import * as $4068f25b from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/index.js";
var InexactRoot = require($4068f25b);
import * as $d2a171d2 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/dir/file.js";
var InexactFile = require($d2a171d2);
import * as $522c6d1f from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/foo.js";
var ExactFile = require($522c6d1f);
Bun.activate(true);

var hmr = new HMR(1953708113, "package-json-exports/index.js"), exports = hmr.exports;
(hmr._load = function() {
  function test() {
    console.assert(InexactRoot.target === "browser");
    console.assert(InexactFile.target === "browser");
    console.assert(ExactFile.target === "browser");
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
