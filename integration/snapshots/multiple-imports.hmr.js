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
import * as $2ed51059 from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($2ed51059);
var jsx = require(JSX).jsxDEV, JSXFrag = require(JSXClassic).Fragment;

var { default: React} = require($2ed51059);
var { default: React2} = require($2ed51059);
Bun.activate(false);

var hmr = new HMR(1572769260, "multiple-imports.js"), exports = hmr.exports;
(hmr._load = function() {
  const bacon = React;
  const bacon2 = jsx(JSXFrag, {
    children: ["hello"]
  }, undefined, true, undefined, this);
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
