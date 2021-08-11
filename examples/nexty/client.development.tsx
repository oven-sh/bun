import ReactDOM from "react-dom";

export function start(EntryPointNamespace) {
  ReactDOM.hydrate(<EntryPointNamespace.default />);
}
