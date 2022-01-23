import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
import {
__require as require
} from "http://localhost:8080/bun:wrap";
import {
__HMRModule as HMR
} from "http://localhost:8080/bun:wrap";
import * as $2f488e5b from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($2f488e5b);
import * as $bbcd215f from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($bbcd215f);
var jsx = require(JSX).jsxDEV, JSXFrag = require(JSXClassic).Fragment;

var { default: React} = require($bbcd215f);
var { default: React2} = require($bbcd215f);
Bun.activate(false);

var hmr = new HMR(2165509932, "multiple-imports.js"), exports = hmr.exports;
(hmr._load = function() {
  const bacon = React;
  const bacon2 = jsx(JSXFrag, {
    children: "hello"
  }, undefined, false, undefined, this);
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
