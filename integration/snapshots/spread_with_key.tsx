import {
__require as require
} from "http://localhost:8080/__runtime.js";
import * as JSX from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
import * as $2ed51059 from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($2ed51059);
var jsx = require(JSX).jsxDEV, jsxEl = require(JSXClassic).createElement;

var { default: React} = require($2ed51059);
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
  }, undefined, true, undefined, this)));
  return testDone(import.meta.url);
}
