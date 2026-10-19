// The server of a `bun bake build`: `dist/server.js` imports this, with the routes of the app, and
// calls `start`. It serves the `.html` pages, the routes of `app/server.ts`, the pages of the
// framework, the browser files and `public/`.
//
// A framework page renders on request with the framework's `render`, as in `bun bake`. A response
// with `Cache-Control: s-maxage=N` is kept in memory for N seconds and sent again for the same path;
// after that, the next request gets the kept response and the page renders again in the background
// (`stale-while-revalidate`). The default framework sets it for pages without
// `getServerSideProps`.

type Params = Record<string, string | string[]>;

type FrameworkRoute = {
  /** `Bun.serve()` route patterns. */
  patterns: string[];
  /** The name of a catch-all parameter (`[...rest]`), which gets the rest of the path. */
  catchAll: string | null;
  /** Where the catch-all part of the path starts: the number of segments before it. */
  catchAllIndex: number;
  render: (request: Request, meta: object) => Response | Promise<Response>;
  page: object;
  /** The inner-most first. */
  layouts: object[];
  modules: string[];
  styles: string[];
};

type Build = {
  app: Record<string, any> | undefined;
  htmlPages: { url: string; bundle: unknown }[];
  frameworkRoutes: FrameworkRoute[];
  /** URL path to file, relative to `dist/`: the browser files and `public/`. */
  files: Record<string, string>;
};

type Kept = {
  status: number;
  headers: Headers;
  body: ArrayBuffer;
  freshUntil: number;
  rendering: boolean;
};

const kept = new Map<string, Kept>();

function keepFor(response: Response): number | undefined {
  if (response.status !== 200) return undefined;
  const cacheControl = response.headers.get("cache-control");
  const maxAge = cacheControl && /(?:^|,)\s*s-maxage=(\d+)/i.exec(cacheControl);
  return maxAge ? Number(maxAge[1]) : undefined;
}

function paramsOf(route: FrameworkRoute, request: Request & { params?: Record<string, string> }): Params {
  const params: Params = { ...request.params };
  if (route.catchAll !== null) {
    const segments = new URL(request.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const rest = segments.slice(route.catchAllIndex);
    if (rest.length > 0) params[route.catchAll] = rest;
  }
  return params;
}

async function render(route: FrameworkRoute, request: Request): Promise<Response> {
  return route.render(request, {
    pageModule: route.page,
    layouts: route.layouts,
    params: paramsOf(route, request),
    modules: route.modules,
    modulepreload: [],
    styles: route.styles,
  });
}

async function renderAndKeep(route: FrameworkRoute, request: Request, key: string): Promise<Response> {
  const response = await render(route, request);
  const seconds = keepFor(response);
  if (seconds === undefined) return response;
  const body = await response.arrayBuffer();
  kept.set(key, {
    status: response.status,
    headers: response.headers,
    body,
    freshUntil: Date.now() + seconds * 1000,
    rendering: false,
  });
  return new Response(body, { status: response.status, headers: response.headers });
}

function handler(route: FrameworkRoute) {
  return async (request: Request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return render(route, request);
    const key = new URL(request.url).pathname;
    const entry = kept.get(key);
    if (entry === undefined) return renderAndKeep(route, request, key);
    if (Date.now() >= entry.freshUntil && !entry.rendering) {
      entry.rendering = true;
      renderAndKeep(route, request, key).then(
        () => {},
        error => {
          entry.rendering = false;
          console.error(error);
        },
      );
    }
    return new Response(entry.body, { status: entry.status, headers: entry.headers });
  };
}

export function start(build: Build) {
  const routes: Record<string, unknown> = {};
  for (const [url, file] of Object.entries(build.files)) {
    routes[url] = new Response(Bun.file(new URL(file, import.meta.url)));
  }
  for (const route of build.frameworkRoutes) {
    const handle = handler(route);
    for (const pattern of route.patterns) routes[pattern] = handle;
  }
  for (const page of build.htmlPages) routes[page.url] = page.bundle;
  const app = build.app;
  const appRoutes = app?.routes ?? app?.static;
  if (appRoutes && typeof appRoutes === "object" && !Array.isArray(appRoutes)) {
    for (const [route, value] of Object.entries(appRoutes)) {
      if (route in routes) throw new Error(`The route "${route}" of app/server.ts is also a page.`);
      routes[route] = value;
    }
  }

  // TEMPORARY: `Bun.serve()` finds the files of an `.html` page from the working directory, not
  // from this bundle's folder.
  const cwd = process.cwd();
  process.chdir(import.meta.dir);
  let server;
  try {
    server = Bun.serve({
      ...app,
      static: undefined,
      routes,
      fetch: app?.fetch ?? (() => new Response("Not Found", { status: 404 })),
      development: false,
      port: process.env.PORT ?? app?.port ?? 3000,
      hostname: process.env.HOST ?? app?.hostname ?? app?.host,
    });
  } finally {
    process.chdir(cwd);
  }
  console.log(`Listening on ${server.url}`);
  return server;
}
