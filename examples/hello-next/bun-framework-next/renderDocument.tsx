import * as App from "next/app";
import { AmpStateContext } from "next/dist/shared/lib/amp-context";
import { HeadManagerContext } from "next/dist/shared/lib/head-manager-context";
import Loadable from "next/dist/shared/lib/loadable";
import { LoadableContext } from "next/dist/shared/lib/loadable-context";
import { RouterContext } from "next/dist/shared/lib/router-context";
import { NextRouter } from "next/dist/shared/lib/router/router";
import {
  AppType,
  ComponentsEnhancer,
  DocumentInitialProps,
  DocumentProps,
  DocumentType,
  getDisplayName,
  loadGetInitialProps,
  NextComponentType,
  RenderPage,
  RenderPageResult,
} from "next/dist/shared/lib/utils";
import * as NextDocument from "next/document";
import * as ReactDOMServer from "react-dom/server.browser";
import * as url from "url";
import * as React from "react";
import * as ReactIs from "react-is";
const dev = process.env.NODE_ENV === "development";

type ParsedUrlQuery = Record<string, string | string[]>;

const isJSFile = (file: string) =>
  file.endsWith(".js") ||
  file.endsWith(".jsx") ||
  file.endsWith(".mjs") ||
  file.endsWith(".ts") ||
  file.endsWith(".tsx");

const notImplementedProxy = (base) =>
  new Proxy(
    {},
    {
      deleteProperty: function (target, prop) {
        return undefined;
      },
      enumerate: function (oTarget, sKey) {
        return [].entries();
      },
      ownKeys: function (oTarget, sKey) {
        return [].values();
      },
      has: function (oTarget, sKey) {
        return false;
      },
      defineProperty: function (oTarget, sKey, oDesc) {
        return undefined;
      },
      getOwnPropertyDescriptor: function (oTarget, sKey) {
        return undefined;
      },
      get(this, prop) {
        throw new ReferenceError(
          `${base} is not available for this environment.`
        );
      },
      set(this, prop, value) {
        throw new ReferenceError(
          `${base} is not available for this environment.`
        );
      },
    }
  );

globalThis.fetch = (url, options) => {
  return Promise.reject(new Error(`fetch is not implemented yet. sorry!!`));
};

function getScripts(files: DocumentFiles) {
  const { context, props } = this;
  const {
    assetPrefix,
    buildManifest,
    isDevelopment,
    devOnlyCacheBusterQueryString,
    disableOptimizedLoading,
  } = context;
  const normalScripts = files.allFiles.filter(isJSFile);
  const lowPriorityScripts = buildManifest.lowPriorityFiles?.filter(isJSFile);

  return [...normalScripts, ...lowPriorityScripts].map((file) => {
    return (
      <script
        key={file}
        src={`${encodeURI(file)}${devOnlyCacheBusterQueryString}`}
        nonce={props.nonce}
        async
        crossOrigin={props.crossOrigin || process.env.__NEXT_CROSS_ORIGIN}
        type="module"
      />
    );
  });
}

// function fixLink(from: string) {
//   if (from.startsWith("/_next/http://") || from.startsWith("/_next/https://"))
//     return from.substring("/_next".length);
//   return from;
// }

// function cloneWithOverwrittenLink(element: React.ReactElement<any>) {
//   const props = { ...element.props };
//   if ("href" in element.props) {
//     props.href = fixLink(props.href);
//   }

//   if ("n-href" in element.props) {
//     props["n-href"] = fixLink(props["n-href"]);
//   }

//   if ("n-src" in element.props) {
//     props["n-src"] = fixLink(props["n-src"]);
//   }

//   if ("src" in element.props) {
//     props["src"] = fixLink(props.src);
//   }

//   return React.cloneElement(element, props);
// }

interface DomainLocale {
  defaultLocale: string;
  domain: string;
  http?: true;
  locales?: string[];
}

function renderDocument(
  Document: DocumentType,
  {
    buildManifest,
    docComponentsRendered,
    props,
    docProps,
    pathname,
    query,
    buildId,
    canonicalBase,
    assetPrefix,
    runtimeConfig,
    nextExport,
    autoExport,
    isFallback,
    dynamicImportsIds,
    dangerousAsPath,
    err,
    dev,
    ampPath,
    ampState,
    inAmpMode,
    hybridAmp,
    dynamicImports,
    headTags,
    gsp,
    gssp,
    customServer,
    gip,
    appGip,
    unstable_runtimeJS,
    unstable_JsPreload,
    devOnlyCacheBusterQueryString,
    scriptLoader,
    locale,
    locales,
    defaultLocale,
    domainLocales,
    isPreview,
    disableOptimizedLoading,
  }: RenderOpts & {
    props: any;
    docComponentsRendered: DocumentProps["docComponentsRendered"];
    docProps: DocumentInitialProps;
    pathname: string;
    query: ParsedUrlQuery;
    dangerousAsPath: string;
    ampState: any;
    ampPath: string;
    inAmpMode: boolean;
    hybridAmp: boolean;
    dynamicImportsIds: (string | number)[];
    dynamicImports: string[];
    headTags: any;
    isFallback?: boolean;
    gsp?: boolean;
    gssp?: boolean;
    customServer?: boolean;
    gip?: boolean;
    appGip?: boolean;
    devOnlyCacheBusterQueryString: string;
    scriptLoader: any;
    isPreview?: boolean;
    autoExport?: boolean;
  }
): string {
  return (
    "<!DOCTYPE html>" +
    ReactDOMServer.renderToStaticMarkup(
      <AmpStateContext.Provider value={ampState}>
        {Document.renderDocument(Document, {
          __NEXT_DATA__: {
            props, // The result of getInitialProps
            page: pathname, // The rendered page
            query, // querystring parsed / passed by the user
            buildId, // buildId is used to facilitate caching of page bundles, we send it to the client so that pageloader knows where to load bundles
            assetPrefix: assetPrefix === "" ? undefined : assetPrefix, // send assetPrefix to the client side when configured, otherwise don't sent in the resulting HTML
            runtimeConfig, // runtimeConfig if provided, otherwise don't sent in the resulting HTML
            nextExport, // If this is a page exported by `next export`
            autoExport, // If this is an auto exported page
            isFallback,
            dynamicIds:
              dynamicImportsIds.length === 0 ? undefined : dynamicImportsIds,
            err: err || undefined, // err: err ? serializeError(dev, err) : undefined, // Error if one happened, otherwise don't sent in the resulting HTML
            gsp, // whether the page is getStaticProps
            gssp, // whether the page is getServerSideProps
            customServer, // whether the user is using a custom server
            gip, // whether the page has getInitialProps
            appGip, // whether the _app has getInitialProps
            locale,
            locales,
            defaultLocale,
            domainLocales,
            isPreview,

            pages: buildManifest.pages,
          },
          buildManifest,
          docComponentsRendered,
          dangerousAsPath,
          canonicalBase,
          ampPath,
          inAmpMode,
          isDevelopment: !!dev,
          hybridAmp,
          dynamicImports,
          assetPrefix,
          headTags,
          unstable_runtimeJS,
          unstable_JsPreload,
          devOnlyCacheBusterQueryString,
          scriptLoader,
          locale,
          disableOptimizedLoading,
          ...docProps,
        })}
      </AmpStateContext.Provider>
    )
  );
}

class ServerRouter implements NextRouter {
  route: string;
  pathname: string;
  query: ParsedUrlQuery;
  asPath: string;
  basePath: string;
  events: any;
  isFallback: boolean;
  locale?: string;
  isReady: boolean;
  locales?: string[];
  defaultLocale?: string;
  domainLocales?: DomainLocale[];
  isPreview: boolean;
  isLocaleDomain: boolean;

  constructor(
    pathname: string,
    query: ParsedUrlQuery,
    as: string,
    { isFallback }: { isFallback: boolean },
    isReady: boolean,
    basePath: string,
    locale?: string,
    locales?: string[],
    defaultLocale?: string,
    domainLocales?: DomainLocale[],
    isPreview?: boolean,
    isLocaleDomain?: boolean
  ) {
    this.route = pathname.replace(/\/$/, "") || "/";
    this.pathname = pathname;
    this.query = query;
    this.asPath = as;
    this.isFallback = isFallback;
    this.basePath = basePath;
    this.locale = locale;
    this.locales = locales;
    this.defaultLocale = defaultLocale;
    this.isReady = isReady;
    this.domainLocales = domainLocales;
    this.isPreview = !!isPreview;
    this.isLocaleDomain = !!isLocaleDomain;
  }

  push(): any {
    noRouter();
  }
  replace(): any {
    noRouter();
  }
  reload() {
    noRouter();
  }
  back() {
    noRouter();
  }
  prefetch(): any {
    noRouter();
  }
  beforePopState() {
    noRouter();
  }
}

function noRouter() {
  const message =
    'No router instance found. you should only use "next/router" inside the client side of your app. https://nextjs.org/docs/messages/no-router-instance';
  throw new Error(message);
}

function enhanceComponents(
  options: ComponentsEnhancer,
  App: AppType,
  Component: NextComponentType
): {
  App: AppType;
  Component: NextComponentType;
} {
  // For backwards compatibility
  if (typeof options === "function") {
    return {
      App,
      Component: options(Component),
    };
  }

  return {
    App: options.enhanceApp ? options.enhanceApp(App) : App,
    Component: options.enhanceComponent
      ? options.enhanceComponent(Component)
      : Component,
  };
}

Object.defineProperty(NextDocument.Head.prototype, "getScripts", {
  get() {
    return getScripts;
  },
});
Object.defineProperty(NextDocument.NextScript.prototype, "getScripts", {
  get() {
    return getScripts;
  },
});

export async function render({
  route,
  PageNamespace,
  AppNamespace,
  appStylesheets = [],
  pageStylesheets = [],
  DocumentNamespace = null,
  buildId,
  routePaths = [],
}: {
  buildId: number;
  route: any;
  PageNamespace: { default: NextComponentType<any> };
  AppNamespace: { default: NextComponentType<any> } | null;
  DocumentNamespace: Object | null;
  appStylesheets: string[];
  pageStylesheets: string[];
  routePaths: string[];
}): Promise<Response> {
  const { default: Component, getStaticProps = null } = PageNamespace || {};
  const { default: AppComponent_ } = AppNamespace || {};
  var query = Object.assign({}, route.query);

  // These are reversed in our Router versus Next.js...mostly due to personal preference.
  const pathname = "/" + route.name;
  var asPath = route.pathname;
  const pages = {};

  for (let path of routePaths) {
    const filePath = path.substring(
      path.indexOf("_next/pages/") + "_next/pages".length
    );
    const name = filePath.substring(0, filePath.indexOf("."));
    pages[name] = [path];
  }

  pages[pathname] = [route.scriptSrc, ...pageStylesheets];

  if (appStylesheets.length > 0) {
    if (pages["/_app"]) {
      pages["/_app"].push(...appStylesheets);
    } else {
      pages["/_app"] = appStylesheets;
    }
  }

  const AppComponent = AppComponent_ || App.default;
  const Document =
    (DocumentNamespace && DocumentNamespace.default) || NextDocument.default;
  //   Document.Html.prototype.getScripts = getScripts;
  // }

  const callMiddleware = async (method: string, args: any[], props = false) => {
    let results: any = props ? {} : [];

    if ((Document as any)[`${method}Middleware`]) {
      let middlewareFunc = await (Document as any)[`${method}Middleware`];
      middlewareFunc = middlewareFunc.default || middlewareFunc;

      const curResults = await middlewareFunc(...args);
      if (props) {
        for (const result of curResults) {
          results = {
            ...results,
            ...result,
          };
        }
      } else {
        results = curResults;
      }
    }
    return results;
  };

  const headTags = (...args: any) => callMiddleware("headTags", args);

  if (!ReactIs.isValidElementType(Component)) {
    const exportNames = Object.keys(PageNamespace || {});

    const reactComponents = exportNames.filter(ReactIs.isValidElementType);
    if (reactComponents.length > 2) {
      throw new Error(
        `\"export default\" missing in ${
          route.filePath
        }.\nTry exporting one of ${reactComponents.join(", ")}\n`
      );
    } else if (reactComponents.length === 2) {
      throw new Error(
        `\"export default\" missing in ${route.filePath}.\n\nTry exporting <${reactComponents[0]} /> or <${reactComponents[1]} />\n`
      );
    } else if (reactComponents.length == 1) {
      throw new Error(
        `\"export default\" missing in ${route.filePath}. Try adding this to the bottom of the file:\n\n        export default ${reactComponents[0]};\n`
      );
    } else if (reactComponents.length == 0) {
      throw new Error(
        `\"export default\" missing in ${route.filePath}. Try exporting a React component.\n`
      );
    }
  }

  const isFallback = !!query.__nextFallback;
  delete query.__nextFallback;
  delete query.__nextLocale;
  delete query.__nextDefaultLocale;

  const isSSG = !!getStaticProps;
  const isBuildTimeSSG = isSSG && false;
  const defaultAppGetInitialProps =
    App.getInitialProps === (App as any).origGetInitialProps;

  const hasPageGetInitialProps = !!(Component as any).getInitialProps;
  const pageIsDynamic = route.kind === "dynamic";
  const isAutoExport = false;

  if (isAutoExport || isFallback) {
    // // remove query values except ones that will be set during export
    // query = {
    //   ...(query.amp
    //     ? {
    //         amp: query.amp,
    //       }
    //     : {}),
    // };
    asPath = `${asPath}${
      // ensure trailing slash is present for non-dynamic auto-export pages
      asPath.endsWith("/") && asPath !== "/" && !pageIsDynamic ? "/" : ""
    }`;
  }

  let head: JSX.Element[] = [
    <meta charSet="utf-8" />,
    <meta name="viewport" content="width=device-width" />,
  ];

  const nextExport = isAutoExport || isFallback;
  const reactLoadableModules: string[] = [];
  var scriptLoader = {};
  const AppContainer = ({ children }: any) => (
    <RouterContext.Provider value={router}>
      {/* <AmpStateContext.Provider value={ampState}> */}
      <HeadManagerContext.Provider
        value={{
          updateHead: (state) => {
            head = state;
          },
          updateScripts: (scripts) => {
            scriptLoader = scripts;
          },
          scripts: {},
          mountedInstances: new Set(),
        }}
      >
        <LoadableContext.Provider
          value={(moduleName) => reactLoadableModules.push(moduleName)}
        >
          {children}
        </LoadableContext.Provider>
      </HeadManagerContext.Provider>
      {/* </AmpStateContext.Provider> */}
    </RouterContext.Provider>
  );

  await Loadable.preloadAll(); // Make sure all dynamic imports are loaded

  const router = new ServerRouter(
    pathname,
    query,
    asPath,
    {
      isFallback: isFallback,
    },
    true,
    Bun.origin,
    null,
    [], // renderOpts.locales,
    null, //renderOpts.defaultLocale,
    [], // renderOpts.domainLocales,
    false,
    false
  );

  const ctx = {
    err: null,
    req: undefined,
    res: undefined,
    pathname,
    query,
    asPath,
    locale: null,
    locales: [],
    defaultLocale: null,
    AppTree: (props: any) => {
      return (
        <AppContainer>
          <App {...props} Component={Component} router={router} />
        </AppContainer>
      );
    },
  };

  var props = await loadGetInitialProps(AppComponent, {
    AppTree: ctx.AppTree,
    Component,
    router,
    ctx,
  });

  // This isn't correct.
  // We don't call getServerSideProps on clients.
  const getServerSideProps = PageNamespace.getServerSideProps;
  if (typeof getServerSideProps === "function") {
    const result = await getServerSideProps({
      params: route.params,
      query: route.query,
      req: notImplementedProxy("req"),
      res: notImplementedProxy("res"),
      resolvedUrl: route.pathname,
      preview: false,
      previewData: null,
      locale: null,
      locales: [],
      defaultLocale: null,
    });

    if (result) {
      if ("props" in result) {
        if (typeof result.props === "object") {
          Object.assign(props, result.props);
        }
      }
    }
  }

  const renderToString = ReactDOMServer.renderToString;
  const ErrorDebug = null;

  const renderPage: RenderPage = (
    options: ComponentsEnhancer = {}
  ): RenderPageResult | Promise<RenderPageResult> => {
    if (ctx.err && ErrorDebug) {
      const htmlOrPromise = renderToString(<ErrorDebug error={ctx.err} />);
      return typeof htmlOrPromise === "string"
        ? { html: htmlOrPromise, head }
        : htmlOrPromise.then((html) => ({
            html,
            head,
          }));
    }

    if (dev && (props.router || props.Component)) {
      throw new Error(
        `'router' and 'Component' can not be returned in getInitialProps from _app.js https://nextjs.org/docs/messages/cant-override-next-props`
      );
    }

    const { App: EnhancedApp, Component: EnhancedComponent } =
      enhanceComponents(options, AppComponent, Component);

    const htmlOrPromise = renderToString(
      <AppContainer>
        <EnhancedApp Component={EnhancedComponent} router={router} {...props} />
      </AppContainer>
    );
    return typeof htmlOrPromise === "string"
      ? { html: htmlOrPromise, head }
      : htmlOrPromise.then((html) => ({
          html,
          head,
        }));
  };

  const documentCtx = { ...ctx, renderPage };
  const docProps: DocumentInitialProps = await loadGetInitialProps(
    Document,
    documentCtx
  );

  if (!docProps || typeof docProps.html !== "string") {
    const message = `"${getDisplayName(
      Document
    )}.getInitialProps()" should resolve to an object with a "html" prop set with a valid html string`;
    throw new Error(message);
  }

  const renderOpts = {
    params: route.params,
  };
  // renderOpts.params = _params || params;

  // parsedUrl.pathname = denormalizePagePath(parsedUrl.pathname!);
  // renderOpts.resolvedUrl = formatUrl({
  //   ...parsedUrl,
  //   query: origQuery,
  // });
  const docComponentsRendered: DocumentProps["docComponentsRendered"] = {};

  const isPreview = false;

  let html = renderDocument(Document, {
    docComponentsRendered,
    ...renderOpts,
    disableOptimizedLoading: false,
    canonicalBase: Bun.origin,
    buildManifest: {
      devFiles: [],
      allFiles: [],
      polyfillFiles: [],
      lowPriorityFiles: [],
      pages: pages,
    },
    // Only enabled in production as development mode has features relying on HMR (style injection for example)
    unstable_runtimeJS: true,
    //   process.env.NODE_ENV === "production"
    //     ? pageConfig.unstable_runtimeJS
    //     : undefined,
    // unstable_JsPreload: pageConfig.unstable_JsPreload,
    unstable_JsPreload: true,
    dangerousAsPath: router.asPath,
    ampState: undefined,
    props,
    assetPrefix: "",
    headTags: await headTags(documentCtx),
    isFallback,
    docProps,
    pathname,
    ampPath: undefined,
    query,
    inAmpMode: false,
    hybridAmp: undefined,
    dynamicImportsIds: [], // Array.from(dynamicImportsIds),
    dynamicImports: [], //Array.from(dynamicImports),
    gsp: !!getStaticProps ? true : undefined,
    gssp: !!getServerSideProps ? true : undefined,
    gip: hasPageGetInitialProps ? true : undefined,
    appGip: !defaultAppGetInitialProps ? true : undefined,
    devOnlyCacheBusterQueryString: "",
    scriptLoader,
    isPreview: isPreview === true ? true : undefined,
    autoExport: isAutoExport === true ? true : undefined,
    nextExport: nextExport === true ? true : undefined,
  })
    .replaceAll("/_next/http://", "http://")
    .replaceAll("/_next/https://", "https://");
  return new Response(html);
}
