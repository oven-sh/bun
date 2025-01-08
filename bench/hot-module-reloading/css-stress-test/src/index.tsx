import ReactDOM from "react-dom";
import { Main } from "./main";

const Base = () => {
  const name = typeof location !== "undefined" ? decodeURIComponent(location.search.substring(1)) : null;
  return <Main productName={name} />;
};

function startReact() {
  ReactDOM.hydrate(<Base />, document.querySelector("#reactroot"));
}

if (typeof window !== "undefined") {
  globalThis.addEventListener("DOMContentLoaded", () => {
    startReact();
  });

  startReact();
}

export { Base };
