import {
__require as require
} from "http://localhost:8080/__runtime.js";
import * as JSX from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
import * as $bbcd215f from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($bbcd215f);
var jsx = require(JSX).jsxDEV, JSXFrag = require(JSXClassic).Fragment;

var { default: React} = require($bbcd215f);
var { default: React2} = require($bbcd215f);
const bacon = React;

const bacon2 = jsx(JSXFrag, {
  children: ["hello"]
}, undefined, true, {}, this);
export function test() {
  console.assert(bacon === React);
  console.assert(bacon === React2);
  console.assert(typeof bacon2 !== "undefined");
  console.assert(React.isValidElement(bacon2));
  return testDone(import.meta.url);
}
