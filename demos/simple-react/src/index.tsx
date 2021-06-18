import ReactDOM from "react-dom";
import React from "react";
import { Button } from "./components/button";
import classNames from "classnames";

const Base = ({}) => {
  return (
    <main className={classNames("main")}>
      <h3 className={classNames("hi")}>Here is some text</h3>
      <h3 className={classNames("extremely")}></h3>
      <>Fargment!1239899s</>

      <Button
        label="Do notencoding! cl1ick."
        onClick={() => alert("I told u not to click!")}
      ></Button>
    </main>
  );
};

function startReact() {
  ReactDOM.render(<Base />, document.querySelector("#reactroot"));
}

globalThis.addEventListener("DOMContentLoaded", () => {
  startReact();
});
startReact();

export { Base };
