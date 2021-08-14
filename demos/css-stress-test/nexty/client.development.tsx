globalThis.process = {
  platform: "posix",
  env: {},
  browser: true,
};

import * as ReactDOM from "react-dom";
import App from "next/app";
import mitt, { MittEmitter } from "next/dist/shared/lib/mitt";
import { RouterContext } from "next/dist/shared/lib/router-context";
import Router, {
  AppComponent,
  AppProps,
  delBasePath,
  hasBasePath,
  PrivateRouteInfo,
} from "next/dist/shared/lib/router/router";
import { isDynamicRoute } from "next/dist/shared/lib/router/utils/is-dynamic";
import {
  urlQueryToSearchParams,
  assign,
} from "next/dist/shared/lib/router/utils/querystring";
import { setConfig } from "next/dist/shared/lib/runtime-config";
import {
  getURL,
  loadGetInitialProps,
  NEXT_DATA,
  ST,
} from "next/dist/shared/lib/utils";
import { Portal } from "next/dist/client/portal";
import initHeadManager from "next/dist/client/head-manager";
import PageLoader, { StyleSheetTuple } from "next/dist/client/page-loader";
import measureWebVitals from "next/dist/client/performance-relayer";
import { RouteAnnouncer } from "next/dist/client/route-announcer";
import {
  createRouter,
  makePublicRouterInstance,
} from "next/dist/client/router";
import "./renderDocument";
export const emitter: MittEmitter<string> = mitt();

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
