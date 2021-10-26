globalThis.global = globalThis;
globalThis.Bun_disableCSSImports = true;

import * as React from "react";
var onlyChildPolyfill = React.Children.only;
React.Children.only = function (children) {
  if (children && typeof children === "object" && children.length == 1) {
    return onlyChildPolyfill(children[0]);
  }

  return onlyChildPolyfill(children);
};

import * as ReactDOM from "react-dom";
import NextApp from "next/app";
import mitt, { MittEmitter } from "next/dist/shared/lib/mitt";
import { RouterContext } from "next/dist/shared/lib/router-context";
import Router, {
  AppComponent,
  AppProps,
  delBasePath,
  hasBasePath,
  PrivateRouteInfo,
} from "next/dist/shared/lib/router/router";

const App = NextApp;

import * as NextRouteLoader from "next/dist/client/route-loader";
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
// import { Portal } from "next/dist/client/portal";
import initHeadManager from "next/dist/client/head-manager";
import { HeadManagerContext } from "next/dist/shared/lib/head-manager-context";
import PageLoader from "./page-loader";
import measureWebVitals from "next/dist/client/performance-relayer";
import { RouteAnnouncer } from "next/dist/client/route-announcer";
import {
  createRouter,
  makePublicRouterInstance,
} from "next/dist/client/router";
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

function nextDataFromBunData() {
  const {
    router: { routes, route, params: paramsList },
    problems,
  } = globalThis.__BUN_DATA__;

  const paramsMap = new Map();
  for (let i = 0; i < paramsList.keys.length; i++) {
    paramsMap.set(
      decodeURIComponent(paramsList.keys[i]),
      decodeURIComponent(paramsList.values[i])
    );
  }

  const params = {};
  var url = new URL(location.href);
  Object.assign(params, Object.fromEntries(url.searchParams.entries()));
  Object.assign(params, Object.fromEntries(paramsMap.entries()));

  const pages = routes.keys.reduce((acc, routeName, i) => {
    const routePath = routes.values[i];
    acc[routeName] = [routePath];
    return acc;
  }, {});

  return {
    page: routes.keys[route],
    buildId: "1234",
    assetPrefix: "",
    isPreview: false,
    locale: null,
    locales: [],
    isFallback: false,
    err: null,
    props: {},
    query: params,
    pages,
  };
}

type RenderRouteInfo = PrivateRouteInfo & {
  App: AppComponent;
  scroll?: { x: number; y: number } | null;
};
type RenderErrorProps = Omit<RenderRouteInfo, "Component" | "styleSheets">;

const nextDataTag = document.getElementById("__NEXT_DATA__");

const data: typeof window["__NEXT_DATA__"] = nextDataTag
  ? JSON.parse(document.getElementById("__NEXT_DATA__")!.textContent!)
  : nextDataFromBunData();
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

export const pageLoader: PageLoader = new PageLoader(
  buildId,
  prefix,
  data.pages
);

const headManager: {
  mountedInstances: Set<unknown>;
  updateHead: (head: JSX.Element[]) => void;
} = initHeadManager();
const appElement: HTMLElement | null = document.getElementById("__next");

let lastRenderReject: (() => void) | null;
let webpackHMR: any;
export let router: Router;
let CachedApp: AppComponent = App,
  onPerfEntry: (metric: any) => void;

export default function boot(EntryPointNamespace, loader) {
  _boot(EntryPointNamespace).then(() => {}, false);
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

const wrapApp =
  (App: AppComponent) =>
  (wrappedAppProps: Record<string, any>): JSX.Element => {
    const appProps: AppProps = {
      ...wrappedAppProps,
      Component: CachedComponent,
      err: hydrateErr,
      router,
    };
    return (
      <AppContainer>
        <App {...appProps} />
      </AppContainer>
    );
  };

function AppContainer({
  children,
}: React.PropsWithChildren<{}>): React.ReactElement {
  return (
    <Container fn={(error) => <div>{JSON.stringify(error)}</div>}>
      <RouterContext.Provider value={makePublicRouterInstance(router)}>
        <HeadManagerContext.Provider value={headManager}>
          {children}
        </HeadManagerContext.Provider>
      </RouterContext.Provider>
    </Container>
  );
}

export async function _boot(EntryPointNamespace, isError) {
  NextRouteLoader.default.getClientBuildManifest = () => Promise.resolve({});

  const PageComponent = EntryPointNamespace.default;

  const appScripts = globalThis.__NEXT_DATA__.pages["/_app"];

  CachedApp = NextApp;

  if (appScripts && appScripts.length > 0) {
    let appSrc;
    for (let asset of appScripts) {
      if (!asset.endsWith(".css")) {
        appSrc = asset;
        break;
      }
    }

    if (appSrc) {
      const AppModule = await import(appSrc);
      console.assert(
        AppModule.default,
        appSrc + " must have a default export'd React component"
      );

      if ("default" in AppModule) {
        CachedApp = AppModule.default;
      }
    }
  }

  router = createRouter(page, query, asPath, {
    initialProps: hydrateProps,
    pageLoader,
    App: CachedApp,
    Component: CachedComponent,
    wrapApp,
    err: null,
    isFallback: Boolean(isFallback),
    subscription: async (info, App, scroll) => {
      return render(
        Object.assign<
          {},
          Omit<RenderRouteInfo, "App" | "scroll">,
          Pick<RenderRouteInfo, "App" | "scroll">
        >({}, info, {
          App,
          scroll,
        })
      );
    },
    locale,
    locales,
    defaultLocale: "",
    domainLocales,
    isPreview,
  });

  globalThis.next.router = router;

  if (isError) {
    ReactDOM.render(
      <TopLevelRender
        App={CachedApp}
        Component={PageComponent}
        props={hydrateProps}
      />,
      document.querySelector("#__next")
    );
  } else {
    ReactDOM.hydrate(
      <TopLevelRender
        App={CachedApp}
        Component={PageComponent}
        props={hydrateProps}
      />,
      document.querySelector("#__next")
    );
  }
}

function TopLevelRender({ App, Component, props, scroll }) {
  return (
    <AppContainer scroll={scroll}>
      <App Component={Component} {...props}></App>
    </AppContainer>
  );
}

export function render(props) {
  ReactDOM.render(
    <TopLevelRender {...props} />,
    document.querySelector("#__next")
  );
}

export function renderError(e) {
  ReactDOM.render(
    <AppContainer>
      <App Component={<div>UH OH!!!!</div>} pageProps={data.props}></App>
    </AppContainer>,
    document.querySelector("#__next")
  );
}

globalThis.next = {
  version: "11.1.2",
  emitter,
  render,
  renderError,
};
