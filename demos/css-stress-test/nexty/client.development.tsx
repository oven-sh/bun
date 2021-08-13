globalThis.process = {
  platform: "posix",
  env: {},
};

import * as ReactDOM from "react-dom";
import App from "next/app";

export default function boot(EntryPointNamespace, loader) {
  _boot(EntryPointNamespace);
}

function _boot(EntryPointNamespace) {
  const next_data_node = document.querySelector("#__NEXT_DATA__");
  if (!next_data_node) {
    throw new Error(
      "__NEXT_DATA__ is missing. That means something went wrong while rendering on the server."
    );
  }

  try {
    globalThis.NEXT_DATA = JSON.parse(next_data_node.innerHTML);
  } catch (error) {
    error.message = `Error parsing __NEXT_DATA__\n${error.message}`;
    throw error;
  }

  const props = { ...globalThis.NEXT_DATA.props };
  const PageComponent = EntryPointNamespace.default;
  ReactDOM.hydrate(
    <App Component={PageComponent} pageProps={props.pageProps}></App>,
    document.querySelector("#__next")
  );
}
