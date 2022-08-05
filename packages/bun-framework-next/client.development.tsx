globalThis.global = globalThis;
globalThis.Bun_disableCSSImports = true;

import * as React from "react";

var ReactDOM;
try {
  ReactDOM = require("react-dom/client");
} catch (exception) {}

if (!ReactDOM) {
  try {
    ReactDOM = require("react-dom");
  } catch (exception) {}
}

import NextApp from "next/app";
import mitt, { MittEmitter } from "next/dist/shared/lib/mitt";
import { RouterContext } from "next/dist/shared/lib/router-context";
import Router, {
  AppComponent,
  AppProps,
  PrivateRouteInfo,
} from "next/dist/shared/lib/router/router";

import NextRouteLoader from "next/dist/client/route-loader";
import { isDynamicRoute } from "next/dist/shared/lib/router/utils/is-dynamic";
import {
  urlQueryToSearchParams,
  assign,
} from "next/dist/shared/lib/router/utils/querystring";
import { setConfig } from "next/dist/shared/lib/runtime-config";
import { getURL, NEXT_DATA } from "next/dist/shared/lib/utils";

import initHeadManager from "next/dist/client/head-manager";
import { HeadManagerContext } from "next/dist/shared/lib/head-manager-context";
import PageLoader from "./page-loader";
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

const nextDataTag = document.getElementById("__NEXT_DATA__");

// pages is added at runtime and doesn't exist in Next types
const data: NEXT_DATA & { pages: Record<string, string[]> } = nextDataTag
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
  // Todo, revist this constant when supporting dynamic()
  dynamicIds,
  isFallback,
  locale,
  locales,
  domainLocales,
  isPreview,
  pages,
} = data;

const prefix: string = assetPrefix || "";

setConfig({
  serverRuntimeConfig: {},
  publicRuntimeConfig: runtimeConfig || {},
});

let asPath: string = getURL();
const basePath = (process.env.__NEXT_ROUTER_BASEPATH as string) || ''

function pathNoQueryHash(path: string) {
  const queryIndex = path.indexOf('?')
  const hashIndex = path.indexOf('#')

  if (queryIndex > -1 || hashIndex > -1) {
    path = path.substring(0, queryIndex > -1 ? queryIndex : hashIndex)
  }
  return path
}

function hasBasePath(path: string): boolean {
  path = pathNoQueryHash(path)
  return path === prefix || path.startsWith(prefix + '/')
}

function delBasePath(path: string): string {
  path = path.slice(basePath.length)
  if (!path.startsWith('/')) path = `/${path}`
  return path
}

// make sure not to attempt stripping basePath for 404s
if (hasBasePath(asPath)) { 
  asPath = delBasePath(asPath);
}

export const pageLoader: PageLoader = new PageLoader(buildId, prefix, pages);

const headManager: {
  mountedInstances: Set<unknown>;
  updateHead: (head: JSX.Element[]) => void;
} = initHeadManager();

export let router: Router;

let CachedApp: AppComponent = null;

export default function boot(EntryPointNamespace) {
  _boot(EntryPointNamespace, false);
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

let reactRoot: any = null;

const USE_REACT_18 = "hydrateRoot" in ReactDOM;

class BootError extends Error {
  constructor(message) {
    super(message);
    this.name = "BootError";
  }
}

export async function _boot(EntryPointNamespace, isError) {
  NextRouteLoader.getClientBuildManifest = () => Promise.resolve({});

  const PageComponent = EntryPointNamespace.default;

  const appScripts = globalThis.__NEXT_DATA__.pages["/_app"];

  //  Type 'typeof App' is not assignable to type 'ComponentClass<AppProps, any>'.
  //  Construct signature return types 'App<any, any, any>' and 'Component<AppProps, any, any>' are incompatible.
  // @ts-expect-error
  CachedApp = NextApp;
  CachedComponent = PageComponent;

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
          Omit<RenderRouteInfo, "App" | "scroll" | "Component">,
          Pick<RenderRouteInfo, "App" | "scroll" | "Component">
        >({}, info, {
          // If we don't have an info.Component, we may be shallow routing,
          // fallback to current entry point
          Component: info.Component || CachedComponent,
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

  var domEl = document.querySelector("#__next");

  if (!domEl) {
    const nextEl = document.createElement("div");
    nextEl.id = "__next";
    document.body.appendChild(nextEl);
    domEl = nextEl;
  }

  const reactEl = (
    <TopLevelRender
      App={CachedApp}
      Component={PageComponent}
      props={hydrateProps}
    />
  );

  if (USE_REACT_18) {
    if (!isError && domEl.hasChildNodes() && !reactRoot) {
      try {
        // Unlike with createRoot, you don't need a separate root.render() call here
        reactRoot = ReactDOM.hydrateRoot(domEl, reactEl);
      } catch (exception) {
        try {
          reactRoot = ReactDOM.createRoot(domEl);
          reactRoot.render(reactEl);
        } catch {
          throw exception;
        }
      }
    } else {
      if (!reactRoot) {
        reactRoot = ReactDOM.createRoot(domEl);
      }

      reactRoot.render(reactEl);
    }
  } else {
    if (isError || !domEl.hasChildNodes() || !("hydrate" in ReactDOM)) {
      ReactDOM.render(reactEl, domEl);
    } else {
      try {
        ReactDOM.hydrate(reactEl, domEl);
      } catch (e) {
        ReactDOM.render(reactEl, domEl);
      }
    }
  }
}

function TopLevelRender({ App, Component, props }) {
  return (
    <AppContainer>
      <App Component={Component} {...props}></App>
    </AppContainer>
  );
}

export function render(props) {
  if (USE_REACT_18) {
    reactRoot.render(<TopLevelRender {...props} />);
  } else {
    ReactDOM.render(
      <TopLevelRender {...props} />,
      document.getElementById("__next")
    );
  }
}

export function renderError(e) {
  const reactEl = <AppContainer>{null}</AppContainer>;

  if (USE_REACT_18) {
    if (!reactRoot) {
      const domEl = document.querySelector("#__next");

      // Unlike with createRoot, you don't need a separate root.render() call here
      reactRoot = ReactDOM.hydrateRoot(domEl, reactEl);
    } else {
      reactRoot.render(reactEl);
    }
  } else {
    const domEl = document.querySelector("#__next");

    ReactDOM.render(reactEl, domEl);
  }
}

globalThis.next = {
  version: "12.0.4",
  emitter,
  render,
  renderError,
};
