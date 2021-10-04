import {
__require as require
} from "http://localhost:8080/__runtime.js";
import {
__HMRModule as HMR
} from "http://localhost:8080/__runtime.js";
import {
__HMRClient as Bun
} from "http://localhost:8080/__runtime.js";
import * as $cc5b5b4d from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/index.js";
var InexactRoot = require($cc5b5b4d);
import * as $3a1d0f08 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/dir/file.js";
var InexactFile = require($3a1d0f08);
import * as $6b803e42 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/foo.js";
var ExactFile = require($6b803e42);
Bun.activate(false);

var hmr = new HMR(3722745821, "package-json-exports/index.js"), exports = hmr.exports;
(hmr._load = function() {
  async function test() {
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
