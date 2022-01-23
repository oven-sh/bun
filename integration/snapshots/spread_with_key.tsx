import {
__require as require
} from "http://localhost:8080/bun:runtime";
import * as $2f488e5b from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($2f488e5b);
import * as $bbcd215f from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($bbcd215f);
var jsx = require(JSX).jsxDEV, jsxEl = require(JSXClassic).createElement;

var { default: React} = require($bbcd215f);
export function SpreadWithTheKey({
  className
}) {
  const rest = {};

  return jsxEl("div", {
    className,
    ...rest,
    onClick: () => console.log("click"),
    key: "spread-with-the-key"
  }, "Rendered component containing warning");
}

export function test() {
  console.assert(React.isValidElement(jsx(SpreadWithTheKey, {
    className: "foo"
  }, undefined, false, undefined, this)));
  return testDone(import.meta.url);
}
