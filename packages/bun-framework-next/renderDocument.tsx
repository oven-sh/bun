import App from "next/app";
import { AmpStateContext } from "next/dist/shared/lib/amp-context";
import { HeadManagerContext } from "next/dist/shared/lib/head-manager-context";
import Loadable from "next/dist/shared/lib/loadable";
import { LoadableContext } from "next/dist/shared/lib/loadable-context";
import { RouterContext } from "next/dist/shared/lib/router-context";
import type { NextRouter } from "next/dist/shared/lib/router/router";
import {
  getDisplayName,
  loadGetInitialProps,
  type AppType,
  type ComponentsEnhancer,
  type DocumentInitialProps,
  type DocumentProps,
  type DocumentType,
  type NextComponentType,
  type RenderPage,
  type RenderPageResult,
} from "next/dist/shared/lib/utils";
import * as NextUtils from "next/dist/shared/lib/utils";
import type { RenderOpts } from "next/dist/server/render";
import * as NextDocument from "next/document";
import * as ReactDOMServer from "react-dom/server.browser";
import * as React from "react";
import * as ReactIs from "react-is";
import packageJson from "next/package.json";

const nextVersion = packageJson.version;

var HtmlContext;
// HtmlContext is in different places depending on the next version
if ("HtmlContext" in NextUtils) {
  HtmlContext = NextUtils.HtmlContext;
} else {
  try {
    HtmlContext = require("next/dist/shared/lib/html-context").HtmlContext;
  } catch (err) {
    throw err;
  }
}

function appendNextBody(documentHTML: string, pageContent: string) {
  if (nextVersion.startsWith("12.0")) {
    const NEXT_12_0_BODY_RENDER_TARGET = "__NEXT_BODY_RENDER_TARGET__";

    const bodyRenderIdx = documentHTML.indexOf(NEXT_12_0_BODY_RENDER_TARGET);

    if (!documentHTML.startsWith("<!DOCTYPE html>")) {
      documentHTML = "<!DOCTYPE html>" + documentHTML;
    }

    return (
      documentHTML.substring(0, bodyRenderIdx) +
      pageContent +
      documentHTML.substring(
        bodyRenderIdx + NEXT_12_0_BODY_RENDER_TARGET.length
      )
    );
  } else {
    var [renderTargetPrefix, renderTargetSuffix] = documentHTML.split(
      "<next-js-internal-body-render-target></next-js-internal-body-render-target>"
    );

    if (!renderTargetPrefix || !renderTargetSuffix) {
      throw new Error(
        "Can't find where your <App /> starts or where the <Document /> ends. \nThis is probably a version incompatibility. Please mention this error in Bun's discord\n\n" +
          documentHTML
      );
    }

    if (!renderTargetPrefix.startsWith("<!DOCTYPE html>")) {
      renderTargetPrefix = "<!DOCTYPE html>" + renderTargetPrefix;
    }

    return (
      renderTargetPrefix +
      `<div id="__next">${pageContent || ""}</div>` +
      renderTargetSuffix
    );
  }
}

const dev = process.env.NODE_ENV === "development";

type ParsedUrlQuery = Record<string, string | string[]>;

const isJSFile = (file: string) =>
  file.endsWith(".js") ||
  file.endsWith(".jsx") ||
  file.endsWith(".mjs") ||
  file.endsWith(".ts") ||
  file.endsWith(".tsx");

type DocumentFiles = {
  sharedFiles: readonly string[];
  pageFiles: readonly string[];
  allFiles: readonly string[];
};

function getScripts(files: DocumentFiles) {
  const { context, props } = this;
  const {
    assetPrefix,
    buildManifest,
    isDevelopment,
    devOnlyCacheBusterQueryString,
  } = context;

  const normalScripts = files?.allFiles?.filter(isJSFile) ?? [];
  const lowPriorityScripts =
    buildManifest?.lowPriorityFiles?.filter(isJSFile) ?? [];
  var entryPointIndex = -1;
  const scripts = [...normalScripts, ...lowPriorityScripts].map(
    (file, index) => {
      // if (file.includes(".entry.")) {
      //   entryPointIndex = index;
      // }

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
    }
  );
  // if (entryPointIndex > 0) {
  //   const entry = scripts.splice(entryPointIndex, 1);
  //   scripts.unshift(...entry);
  // }

  return scripts;
}

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
    page,
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
    //
    page: string;
    //
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
  const htmlProps = {
    __NEXT_DATA__: {
      props, // The result of getInitialProps
      page: page, // The rendered page
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
    useMaybeDeferContent,
    ...docProps,
  };

  return ReactDOMServer.renderToStaticMarkup(
    <AmpStateContext.Provider value={ampState}>
      {/* HTMLContextProvider expects useMainContent */}
      {/* @ts-expect-error */}
      <HtmlContext.Provider value={htmlProps}>
        {/* Document doesn't expect useMaybeDeferContent */}
        {/* @ts-expect-error */}
        <Document {...htmlProps} {...docProps}></Document>
      </HtmlContext.Provider>
    </AmpStateContext.Provider>
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
    this.pathname = new URL(
      pathname || "/",
      Bun.origin || "http://localhost:3000"
    ).href;

    this.query = query;
    this.asPath = new URL(
      as || "/",
      Bun.origin || "http://localhost:3000"
    ).href;
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
const scriptsGetter = {
  get() {
    return getScripts;
  },
};

Object.defineProperty(NextDocument.Head.prototype, "getScripts", scriptsGetter);
Object.defineProperty(
  NextDocument.NextScript.prototype,
  "getScripts",
  scriptsGetter
);
try {
  Object.defineProperty(
    NextDocument.default.prototype,
    "getScripts",
    scriptsGetter
  );
} catch {}
try {
  Object.defineProperty(NextDocument.default, "getScripts", scriptsGetter);
} catch {}

export async function render({
  route,
  request,
  PageNamespace,
  AppNamespace,
  appStylesheets = [],
  pageStylesheets = [],
  DocumentNamespace = null,
  buildId,
  routePaths = [],
  routeNames = [],
}: {
  buildId: number;
  route: any;
  PageNamespace: { default: NextComponentType<any> };
  AppNamespace: { default: NextComponentType<any> } | null;
  DocumentNamespace: Object | null;
  appStylesheets: string[];
  pageStylesheets: string[];
  routePaths: string[];
  routeNames: string[];
  request: Request;
}): Promise<Response> {
  const { default: Component } = PageNamespace || {};
  const getStaticProps = (PageNamespace as any)?.getStaticProps || null;
  const { default: AppComponent_ } = AppNamespace || {};
  var query = Object.assign({}, route.query);
  const origin = Bun.origin;

  // These are reversed in our Router versus Next.js...mostly due to personal preference.
  const pathname = route.name;
  var asPath = route.pathname;
  const pages = {};

  for (let i = 0; i < routeNames.length; i++) {
    const filePath = routePaths[i];
    const name = routeNames[i];
    pages[name] = [filePath];
  }

  if (appStylesheets.length > 0) {
    if (pages["/_app"]) {
      pages["/_app"].push(...appStylesheets);
    } else {
      pages["/_app"] = appStylesheets;
    }
  }
  pages[pathname] = [route.scriptSrc, ...pageStylesheets];

  if (!("/_app" in pages)) {
    pages["/_app"] = [];
  }

  const AppComponent = AppComponent_ || App;
  const Document = (DocumentNamespace as any)?.default || NextDocument.default;

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

  // const isSSG = !!getStaticProps;

  const defaultAppGetInitialProps =
    App.getInitialProps === (App as any).origGetInitialProps;

  const hasPageGetInitialProps = !!(Component as any).getInitialProps;
  const pageIsDynamic = route.kind === "dynamic";
  const isPreview = false;
  const isAutoExport = false;
  const nextExport = isAutoExport || isFallback;

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

  // Todo: Double check this when adding support for dynamic()
  await Loadable.preloadAll(); // Make sure all dynamic imports are loaded

  const router = new ServerRouter(
    pathname,
    query,
    asPath,
    {
      isFallback: isFallback,
    },
    true,
    origin,
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
    defaultGetInitialProps: async (
      docCtx: NextDocument.DocumentContext
    ): Promise<DocumentInitialProps> => {
      const enhanceApp = (AppComp: any) => {
        return (props: any) => <AppComp {...props} />;
      };

      const { html, head } = await docCtx.renderPage({ enhanceApp });
      // const styles = jsxStyleRegistry.styles();
      return { html, head };
    },
  };

  var props: any = await loadGetInitialProps(AppComponent, {
    AppTree: ctx.AppTree,
    Component,
    router,
    ctx,
  });

  const pageProps = Object.assign({}, props.pageProps || {});
  // We don't call getServerSideProps on clients.
  // @ts-expect-error
  const getServerSideProps = PageNamespace.getServerSideProps;

  var responseHeaders: Headers;

  if (typeof getServerSideProps === "function") {
    const result = await getServerSideProps({
      params: route.params,
      query: route.query,
      req: {
        destroy() {},
        method: request.method,
        httpVersion: "1.1",
        rawHeaders: [],
        rawTrailers: [],
        socket: null,
        statusCode: 200,
        statusMessage: "OK",
        trailers: {},
        url: request.url,
        headers: new Proxy(
          {},
          {
            get(target, name) {
              return request.headers.get(name as string);
            },
            has(target, name) {
              return request.headers.has(name as string);
            },
          }
        ),
      },
      res: {
        getHeaders() {
          return {};
        },
        getHeaderNames() {
          return {};
        },
        flushHeaders() {},
        getHeader(name) {
          if (!responseHeaders) return undefined;
          return responseHeaders.get(name);
        },
        hasHeader(name) {
          if (!responseHeaders) return undefined;
          return responseHeaders.has(name);
        },
        headersSent: false,
        setHeader(name, value) {
          responseHeaders = responseHeaders || new Headers();
          responseHeaders.set(name, String(value));
        },
        cork() {},
        end() {},
        finished: false,
      },
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
          Object.assign(pageProps, result.props);
        }
      }
    }
  } else if (typeof getStaticProps === "function") {
    const result = await getStaticProps({
      params: route.params,
      query: route.query,
      req: null,
      res: null,
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
          Object.assign(pageProps, result.props);
        }
      }
    }
  }

  const renderToString = ReactDOMServer.renderToString;
  const ErrorDebug = null;

  props.pageProps = pageProps;

  const renderPage: RenderPage = (
    options: ComponentsEnhancer = {}
  ): RenderPageResult | Promise<RenderPageResult> => {
    if (ctx.err && ErrorDebug) {
      const htmlOrPromise = renderToString(<ErrorDebug error={ctx.err} />);
      return { html: htmlOrPromise, head };
    }

    if (dev && (props.router || props.Component)) {
      throw new Error(
        `'router' and 'Component' can not be returned in getInitialProps from _app.js https://nextjs.org/docs/messages/cant-override-next-props`
      );
    }

    const { App: EnhancedApp, Component: EnhancedComponent } =
      // Argument of type 'NextComponentType<any, {}, {}> | typeof App' is not assignable to parameter of type 'AppType'.
      // @ts-expect-error
      enhanceComponents(options, AppComponent, Component);

    const htmlOrPromise = renderToString(
      <AppContainer>
        <EnhancedApp
          Component={EnhancedComponent}
          router={router}
          {...props}
          pageProps={pageProps}
        />
      </AppContainer>
    );

    return { html: htmlOrPromise, head };
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

  const docComponentsRendered: DocumentProps["docComponentsRendered"] = {};

  let html = renderDocument(Document, {
    docComponentsRendered,
    ...renderOpts,
    disableOptimizedLoading: false,
    canonicalBase: origin,
    buildManifest: {
      devFiles: [],
      allFiles: [],
      polyfillFiles: [],
      lowPriorityFiles: [],
      // buildManifest doesn't expect pages, even though its used
      // @ts-expect-error
      pages,
    },
    // Only enabled in production as development mode has features relying on HMR (style injection for example)
    // @ts-expect-error
    unstable_runtimeJS: true,
    //   process.env.NODE_ENV === "production"
    //     ? pageConfig.unstable_runtimeJS
    //     : undefined,
    // unstable_JsPreload: pageConfig.unstable_JsPreload,
    // @ts-expect-error
    unstable_JsPreload: true,
    dangerousAsPath: router.asPath,
    ampState: undefined,
    props,
    assetPrefix: "",
    headTags: await headTags(documentCtx),
    isFallback,
    docProps,
    page: pathname,
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
    isPreview: isPreview,
    autoExport: nextExport === true ? true : undefined,
    nextExport: nextExport,
    useMaybeDeferContent,
  });
  // __NEXT_BODY_RENDER_TARGET__
  html = appendNextBody(html, docProps.html);
  html = html
    .replaceAll('"/_next/http://', '"http://')
    .replaceAll('"/_next/https://', '"https://');
  if (responseHeaders) {
    return new Response(html, { headers: responseHeaders });
  } else {
    return new Response(html);
  }
}

export function useMaybeDeferContent(
  _name: string,
  contentFn: () => JSX.Element
): [boolean, JSX.Element] {
  return [false, contentFn()];
}
