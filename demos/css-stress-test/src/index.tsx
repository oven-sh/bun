import { Main } from "./main";
import classNames from "classnames";
const Base = ({}) => {
  const name =
    typeof location !== "undefined"
      ? decodeURIComponent(location.search.substring(1))
      : null;
  return <Main productName={name || "Bundler"} />;
};

function startReact() {
  const ReactDOM = require("react-dom");
  ReactDOM.render(<Base />, document.querySelector("#reactroot"));
}

if (typeof window !== "undefined") {
  console.log("HERE!!");
  globalThis.addEventListener("DOMContentLoaded", () => {
    startReact();
  });

  startReact();
} else {
  const ReactDOMServer = require("react-dom/server.browser");
  console.log(ReactDOMServer.renderToString(<Base />));
}

export { Base };
