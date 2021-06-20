import ReactDOM from "react-dom";
import React from "react";
import { Main } from "./main";
import classNames from "classnames";

const Base = ({}) => {
  const name = decodeURIComponent(location.search.substring(1));
  return <Main productName={name || "Bundler"} />;
};

function startReact() {
  ReactDOM.render(<Base />, document.querySelector("#reactroot"));
}

globalThis.addEventListener("DOMContentLoaded", () => {
  startReact();
});
startReact();

export { Base };
