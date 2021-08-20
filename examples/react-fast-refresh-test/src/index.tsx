import ReactDOM from "react-dom";
import React from "react";
import { App } from "./components/app";
import classNames from "classnames";

function startReact() {
  ReactDOM.render(<App />, document.querySelector("#reactroot"));
}

globalThis.addEventListener("DOMContentLoaded", () => {
  startReact();
});
startReact();

export { App };
