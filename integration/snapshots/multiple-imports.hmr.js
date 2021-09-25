import {
__HMRClient as Bun
} from "http://localhost:8080/__runtime.js";
import {
__require as require
} from "http://localhost:8080/__runtime.js";
import {
__HMRModule as HMR
} from "http://localhost:8080/__runtime.js";
import * as JSX from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
import * as $bbcd215f from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($bbcd215f);
var jsx = require(JSX).jsxDEV, fileName = "multiple-imports.js", JSXFrag = require(JSXClassic).Fragment;

var { default: React} = require($bbcd215f);
var { default: React2} = require($bbcd215f);
Bun.activate(false);

var hmr = new HMR(2165509932, "multiple-imports.js"), exports = hmr.exports;
(hmr._load = function() {
  const bacon = React;
  const bacon2 = jsx(JSXFrag, {
    children: ["hello"]
  }, undefined, true, {
    fileName,
    lineNumber: 92
  }, this);
  function test() {
    console.assert(bacon === React);
    console.assert(bacon === React2);
    console.assert(typeof bacon2 !== "undefined");
    console.assert(React.isValidElement(bacon2));
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
