import ReactDOM from "react-dom";
import { Button } from "./components/button";

const Base = ({}) => {
  return (
    <main>
      <h1>I am the page</h1>
      <h3>Here is some text</h3>
      <Button
        label="Do not click."
        onClick={() => alert("I told u not to click!")}
      ></Button>
    </main>
  );
};

function startReact() {
  ReactDOM.render(() => <Base />, document.querySelector("#reactroot"));
}

globalThis.addEventListener("DOMContentLoaded", () => {
  startReact();
});
