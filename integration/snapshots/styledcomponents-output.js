import {
__require as require
} from "http://localhost:8080/bun:runtime";
import * as $2f488e5b from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($2f488e5b);
var jsx = require(JSX).jsxDEV;

import * as $d4051a2e from "http://localhost:8080/node_modules/styled-components/dist/styled-components.browser.esm.js";
var { default: styled} = require($d4051a2e);
import * as $bbcd215f from "http://localhost:8080/node_modules/react/index.js";
var { default: React} = require($bbcd215f);
import * as $5b3cea55 from "http://localhost:8080/node_modules/react-dom/index.js";
var { default: ReactDOM} = require($5b3cea55);
const ErrorScreenRoot = styled.div`
  font-family: "Muli", -apple-system, BlinkMacSystemFont, Helvetica, Arial,
    sans-serif;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: #fff;
  text-align: center;
  background-color: #0b2988;
  color: #fff;
  font-family: "Muli", -apple-system, BlinkMacSystemFont, Helvetica, Arial,
    sans-serif;
  line-height: 1.5em;

  & > p {
    margin-top: 10px;
  }

  & a {
    color: inherit;
  }
`;

export function test() {
  if (typeof window !== "undefined") {
    const reactEl = document.createElement("div");
    document.body.appendChild(reactEl);
    ReactDOM.render(jsx(ErrorScreenRoot, {
      id: "error-el",
      children: "The react child should have this text"
    }, undefined, false, undefined, this), reactEl);
    const style = document.querySelector("style[data-styled]");
    console.assert(style, "style tag should exist");
    console.assert(style.textContent.split("").every((a) => a.codePointAt(0) < 128), "style tag should not contain invalid unicode codepoints");
    console.assert(document.querySelector("#error-el").textContent === "The react child should have this text");
    ReactDOM.unmountComponentAtNode(reactEl);
    reactEl.remove();
    style.remove();
    return testDone(import.meta.url);
  }
  return testDone(import.meta.url);
}
