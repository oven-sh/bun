import {
__require as require
} from "http://localhost:8080/__runtime.js";
import * as JSX from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
import * as $bbcd215f from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($bbcd215f);
var jsx = require(JSX).jsxDEV, fileName = "spread_with_key.tsx", jsxEl = require(JSXClassic).createElement;

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
  }, undefined, true, {
    fileName,
    lineNumber: 375
  }, this)));
  return testDone(import.meta.url);
}
