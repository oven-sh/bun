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
import * as React from "react";
export const emitter: MittEmitter<string> = mitt();

declare global {
  interface Window {
    /* test fns */
    __NEXT_HYDRATED?: boolean;
    __NEXT_HYDRATED_CB?: () => void;

    /* prod */
    __NEXT_PRELOADREADY?: (ids?: (string | number)[]) => void;
    __NEXT_DATA__: NEXT_DATA;
    __NEXT_P: any[];
  }
}

type RenderRouteInfo = PrivateRouteInfo & {
  App: AppComponent;
  scroll?: { x: number; y: number } | null;
};
type RenderErrorProps = Omit<RenderRouteInfo, "Component" | "styleSheets">;

const data: typeof window["__NEXT_DATA__"] = JSON.parse(
  document.getElementById("__NEXT_DATA__")!.textContent!
);
window.__NEXT_DATA__ = data;

const {
  props: hydrateProps,
  err: hydrateErr,
  page,
  query,
  buildId,
  assetPrefix,
  runtimeConfig,
  dynamicIds,
  isFallback,
  locale,
  locales,
  domainLocales,
  isPreview,
} = data;

const prefix: string = assetPrefix || "";

setConfig({
  serverRuntimeConfig: {},
  publicRuntimeConfig: runtimeConfig || {},
});

let asPath: string = getURL();

// make sure not to attempt stripping basePath for 404s
if (hasBasePath(asPath)) {
  asPath = delBasePath(asPath);
}

const pageLoader: PageLoader = new PageLoader(buildId, prefix);

const headManager: {
  mountedInstances: Set<unknown>;
  updateHead: (head: JSX.Element[]) => void;
} = initHeadManager();
const appElement: HTMLElement | null = document.getElementById("__next");

let lastRenderReject: (() => void) | null;
let webpackHMR: any;
export let router: Router;
let CachedApp: AppComponent, onPerfEntry: (metric: any) => void;

export default function boot(EntryPointNamespace, loader) {
  _boot(EntryPointNamespace);
}

class Container extends React.Component<{
  fn: (err: Error, info?: any) => void;
}> {
  componentDidCatch(componentErr: Error, info: any) {
    this.props.fn(componentErr, info);
  }

  componentDidMount() {
    this.scrollToHash();

    // We need to replace the router state if:
    // - the page was (auto) exported and has a query string or search (hash)
    // - it was auto exported and is a dynamic route (to provide params)
    // - if it is a client-side skeleton (fallback render)
    if (
      router.isSsr &&
      // We don't update for 404 requests as this can modify
      // the asPath unexpectedly e.g. adding basePath when
      // it wasn't originally present
      page !== "/404" &&
      page !== "/_error" &&
      (isFallback ||
        (data.nextExport &&
          (isDynamicRoute(router.pathname) ||
            location.search ||
            process.env.__NEXT_HAS_REWRITES)) ||
        (hydrateProps &&
          hydrateProps.__N_SSG &&
          (location.search || process.env.__NEXT_HAS_REWRITES)))
    ) {
      // update query on mount for exported pages
      router.replace(
        router.pathname +
          "?" +
          String(
            assign(
              urlQueryToSearchParams(router.query),
              new URLSearchParams(location.search)
            )
          ),
        asPath,
        {
          // @ts-ignore
          // WARNING: `_h` is an internal option for handing Next.js
          // client-side hydration. Your app should _never_ use this property.
          // It may change at any time without notice.
          _h: 1,
          // Fallback pages must trigger the data fetch, so the transition is
          // not shallow.
          // Other pages (strictly updating query) happens shallowly, as data
          // requirements would already be present.
          shallow: !isFallback,
        }
      );
    }
  }

  componentDidUpdate() {
    this.scrollToHash();
  }

  scrollToHash() {
    let { hash } = location;
    hash = hash && hash.substring(1);
    if (!hash) return;

    const el: HTMLElement | null = document.getElementById(hash);
    if (!el) return;

    // If we call scrollIntoView() in here without a setTimeout
    // it won't scroll properly.
    setTimeout(() => el.scrollIntoView(), 0);
  }

  render() {
    return this.props.children;
  }
}

let CachedComponent: React.ComponentType;

function _boot(EntryPointNamespace) {
  const PageComponent = EntryPointNamespace.default;
  
  ReactDOM.hydrate(
    <Container fn={(error) => <div>{JSON.stringify(error)}</div>}>
      <App Component={PageComponent} pageProps={data.props}></App>
    </Container>,

    document.querySelector("#__next")
  );
}
