import * as _react_dot_jsx from "http://localhost:8080/node_modules/react/index.js";
var jsxDEV = __require(_react_dot_jsx).jsxDEV,
  __jsxFilename = "src/index.tsx";

import { __require } from "http://localhost:8080/__runtime.js";
import ReactDOM from "http://localhost:8080/node_modules/react-dom/index.js";
import { Button } from "http://localhost:8080/src/components/button.js";

const Base = ({}) => {
  return jsxDEV(
    "main",
    {
      children: [
        jsxDEV(
          "h1",
          {
            children: "I am the page",
          },
          null,
          false,
          {
            filename: __jsxFilename,
            lineNumber: 132,
            columnNumber: 132,
          },
          this
        ),
        jsxDEV(
          "h3",
          {
            children: "Here is some text",
          },
          null,
          false,
          {
            filename: __jsxFilename,
            lineNumber: 161,
            columnNumber: 161,
          },
          this
        ),
        jsxDEV(
          Button,
          {
            label: "Do not click.",
            onClick: () => alert("I told u not to click!"),
            children: [],
          },
          null,
          false,
          {
            filename: __jsxFilename,
            lineNumber: 194,
            columnNumber: 194,
          },
          this
        ),
      ],
    },
    null,
    false,
    {
      filename: __jsxFilename,
      lineNumber: 119,
      columnNumber: 119,
    },
    this
  );
};

function startReact() {
  ReactDOM.render(
    () =>
      jsxDEV(
        Base,
        {
          children: [],
        },
        null,
        false,
        {
          filename: __jsxFilename,
          lineNumber: 374,
          columnNumber: 374,
        },
        this
      ),
    document.querySelector("#reactroot")
  );
}
globalThis.addEventListener("DOMContentLoaded", () => {
  startReact();
});
