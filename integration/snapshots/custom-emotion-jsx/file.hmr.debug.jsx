import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:8080/bun:wrap";
import {
__require as require
} from "http://localhost:8080/bun:wrap";
import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshModule as FastHMR
} from "http://localhost:8080/bun:wrap";
import * as $72625799 from "http://localhost:8080/node_modules/@emotion/react/jsx-dev-runtime/dist/emotion-react-jsx-dev-runtime.browser.esm.js";
var JSX = require($72625799);
var jsx = require(JSX).jsxDEV;

import * as $5b3cea55 from "http://localhost:8080/node_modules/react-dom/index.js";
var ReactDOM = require($5b3cea55);
Bun.activate(true);

var hmr = new FastHMR(2497996991, "custom-emotion-jsx/file.jsx", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  var Foo = () => jsx("div", {
    css: {content: '"it worked!"' }
  }, undefined, false, undefined, this);
  function test() {
    const element = document.createElement("div");
    element.id = "custom-emotion-jsx";
    document.body.appendChild(element);
    ReactDOM.render(jsx(Foo, {}, undefined, false, undefined, this), element);
    const style = window.getComputedStyle(element.firstChild);
    if (!(style["content"] ?? "").includes("it worked!"))
      throw new Error('Expected "it worked!" but received: ' + style["content"]);
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    Foo: () => Foo,
    test: () => test
  });
})();
var $$hmr_Foo = hmr.exports.Foo, $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_Foo = exports.Foo;
  $$hmr_test = exports.test;
};

export {
  $$hmr_Foo as Foo,
  $$hmr_test as test
};
