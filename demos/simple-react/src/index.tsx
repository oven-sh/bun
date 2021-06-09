import ReactDOM from "react-dom";
import { Button } from "./components/button";
import { DatePicker } from "antd";

const Base = ({}) => {
  return (
    <main>
      <h1>I am the page</h1>
      <h3 className="bacon">Here is some text</h3>
      <>Fragmen!t</>
      <DatePicker />

      <Button
        label="Do not click."
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

export { Base };
