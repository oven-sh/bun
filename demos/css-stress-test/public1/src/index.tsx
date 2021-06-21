import * as jsx_dev_runtime_runtime  from "http://localhost:8000node_modules/react/jsx-dev-runtime.js";
import * as React_dot_jsx  from "http://localhost:8000node_modules/react/jsx-dev-runtime.js";
var jsxDEV =  require( jsx_dev_runtime_runtime).jsxDEV, __jsxFilename = "src/index.tsx", Fragment =  require( React_dot_jsx).Fragment;

import {
 __require  as require
}  from "http://localhost:8000__runtime.js";
import * as ttp_localhost_8000node_modules_module from "http://localhost:8000node_modules/react-dom/index.js";
var ReactDOM = require(ttp_localhost_8000node_modules_module);
import { Button}  from "http://localhost:8000src/components/button.js";
const Base = ({}) => {
  return  jsxDEV("main", {
    children: [
      jsxDEV("h1", {
        children: ["I am the page"]
      }, undefined,  true, {
        fileName: __jsxFilename,
        lineNumber: 132
      }, this),
      jsxDEV("h3", {
        className: "bacon",
        children: ["Here is some text"]
      }, undefined,  true, {
        fileName: __jsxFilename,
        lineNumber: 161
      }, this),
      jsxDEV( Fragment, {
        children: ["Fragmen!t"]
      }, undefined,  true, {
        fileName: __jsxFilename,
        lineNumber: 212
      }, this),
      jsxDEV(Button, {
        label: "Do not click.",
        onClick: () => alert("I told u not to click!"),
        children: []
      }, undefined,  true, {
        fileName: __jsxFilename,
        lineNumber: 234
      }, this)
    ]
  }, undefined,  true, {
    fileName: __jsxFilename,
    lineNumber: 119
  }, this);

};

function startReact() {
  ReactDOM.render( jsxDEV( Base, {
    children: []
  }, undefined,  true, {
    fileName: __jsxFilename,
    lineNumber: 408
  }, this),  document.querySelector("#reactroot"));
}
globalThis.addEventListener("DOMContentLoaded", () => {
  startReact();
});
