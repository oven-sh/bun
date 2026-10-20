// The server of a `bun bake build`: `dist/server.js` imports this, with the routes of the app, and
// calls `start`. It serves the `.html` pages, the routes of `app/server.ts`, the pages of the
// framework, the browser files and `public/`.
//
// A framework page renders on request with the framework's `render`, as in `bun bake`. A response
// to a GET with `Cache-Control: s-maxage=N` is kept in memory for N seconds and sent again for the
// same path, whatever the query: a response that depends on the query must not set `s-maxage`. After
// that, the next request gets the kept response and the page renders again in the background
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
  modulepreload: string[];
  styles: string[];
  /** Its last response was not kept, so requests for one path do not wait for each other. */
  rendersPerRequest?: boolean;
};

type Build = {
  app: Record<string, any> | undefined;
  frameworkRoutes: FrameworkRoute[];
  /** URL path to file, relative to `dist/`: the `.html` pages, the browser files and `public/`. */
  files: Record<string, string>;
  /** The URL paths in `files` that are `.html` pages. */
  htmlPages: string[];
};

type Kept = {
  status: number;
  headers: Headers;
  body: ArrayBuffer;
  freshUntil: number;
};

/** A render for one path: the response that was kept, or one that cannot be. */
type Rendered = { kept: Kept } | { response: Response; controller: AbortController };

/** Any URL can make a page: the least recently used pages go first past these. */
const maxKeptPages = 10_000;
const maxKeptBytes = 128 * 1024 * 1024;

/** The least recently used first. */
const kept = new Map<string, Kept>();
let keptBytes = 0;
const rendering = new Map<string, Promise<Rendered>>();

function forget(key: string) {
  const entry = kept.get(key);
  if (entry === undefined) return;
  keptBytes -= entry.body.byteLength;
  kept.delete(key);
}

function keep(key: string, entry: Kept) {
  forget(key);
  kept.set(key, entry);
  keptBytes += entry.body.byteLength;
  for (const oldest of kept.keys()) {
    if (kept.size <= maxKeptPages && keptBytes <= maxKeptBytes) break;
    forget(oldest);
  }
}

function keepFor(response: Response): number | undefined {
  if (response.status !== 200) return undefined;
  const cacheControl = response.headers.get("cache-control");
  const maxAge = cacheControl && /(?:^|,)\s*s-maxage=(\d+)/i.exec(cacheControl);
  const seconds = maxAge ? Number(maxAge[1]) : 0;
  return seconds > 0 ? seconds : undefined;
}

/**
 * The parameters of a request, as `bun bake` gives them: `null` when it has none. `undefined` when
 * its path cannot be decoded.
 */
function paramsOf(
  route: FrameworkRoute,
  request: Request & { params?: Record<string, string> },
): Params | null | undefined {
  const params: Params = { ...request.params };
  if (route.catchAll !== null) {
    let segments: string[];
    try {
      segments = new URL(request.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    } catch (error) {
      if (error instanceof URIError) return undefined;
      throw error;
    }
    const rest = segments.slice(route.catchAllIndex);
    if (rest.length > 0) params[route.catchAll] = rest;
  }
  return Object.keys(params).length > 0 ? params : null;
}

async function render(route: FrameworkRoute, request: Request, params: Params | null): Promise<Response> {
  return route.render(request, {
    pageModule: route.page,
    layouts: route.layouts,
    params,
    modules: route.modules,
    modulepreload: route.modulepreload,
    styles: route.styles,
  });
}

function respond(entry: Kept) {
  return new Response(entry.body, { status: entry.status, headers: entry.headers });
}

/**
 * Renders a GET of the path and keeps the response if it can. The request has a signal of its own:
 * a page that is kept, and that other requests wait for, is rendered in full when a client goes
 * away, not with the loading state that React writes when its signal aborts.
 */
function renderToKeep(route: FrameworkRoute, request: Request, params: Params | null, key: string) {
  const controller = new AbortController();
  const run = async (): Promise<Rendered> => {
    const response = await render(route, new Request(request, { method: "GET", signal: controller.signal }), params);
    const seconds = keepFor(response);
    route.rendersPerRequest = seconds === undefined;
    if (seconds === undefined) {
      forget(key);
      return { response, controller };
    }
    const entry = {
      status: response.status,
      headers: response.headers,
      body: await response.arrayBuffer(),
      freshUntil: Date.now() + seconds * 1000,
    };
    keep(key, entry);
    return { kept: entry };
  };
  const running = run().finally(() => {
    if (rendering.get(key) === running) rendering.delete(key);
  });
  rendering.set(key, running);
  return running;
}

/** Renders a kept page again. On a failure it stays, and the next request tries again. */
async function renderAgain(route: FrameworkRoute, request: Request, params: Params | null, key: string) {
  try {
    const result = await renderToKeep(route, request, params, key);
    if ("kept" in result) return;
    result.controller.abort();
    await result.response.body?.cancel();
  } catch (error) {
    console.error(error);
  }
}

function handler(route: FrameworkRoute) {
  return async (request: Request) => {
    const params = paramsOf(route, request);
    if (params === undefined) return new Response("Not Found", { status: 404 });
    const { method } = request;
    if (method !== "GET" && method !== "HEAD") return render(route, request, params);
    const key = new URL(request.url).pathname;
    const entry = kept.get(key);
    if (entry !== undefined) {
      kept.delete(key);
      kept.set(key, entry);
      if (Date.now() >= entry.freshUntil && !rendering.has(key)) renderAgain(route, request, params, key);
      return respond(entry);
    }
    if (method === "HEAD") return render(route, request, params);

    const running = route.rendersPerRequest ? undefined : rendering.get(key);
    const result = await (running ?? renderToKeep(route, request, params, key));
    if ("kept" in result) return respond(result.kept);
    // That render was for another request, and this response cannot be shared.
    if (running !== undefined) return render(route, request, params);
    // Only this request gets it, so its client going away ends it.
    const { response, controller } = result;
    const { signal } = request;
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
    return response;
  };
}

export function start(build: Build) {
  const routes: Record<string, any> = {};
  for (const [url, file] of Object.entries(build.files)) {
    routes[url] = new Response(Bun.file(new URL(file, import.meta.url)));
  }
  const pages = new Set(build.htmlPages);
  for (const route of build.frameworkRoutes) {
    const handle = handler(route);
    for (const pattern of route.patterns) {
      routes[pattern] = handle;
      pages.add(pattern);
    }
  }
  const { static: staticRoutes, ...app } = build.app ?? {};
  const appRoutes = app.routes ?? staticRoutes;
  if (appRoutes && typeof appRoutes === "object" && !Array.isArray(appRoutes)) {
    for (const [route, value] of Object.entries(appRoutes)) {
      if (pages.has(route)) throw new Error(`The route "${route}" of app/server.ts is also a page.`);
      routes[route] = value;
    }
  }

  const server = Bun.serve({
    ...app,
    routes,
    fetch: app.fetch ?? (() => new Response("Not Found", { status: 404 })),
    development: false,
    port: process.env.PORT ?? app.port ?? 3000,
    hostname: process.env.HOST ?? app.hostname ?? app.host,
  });
  console.log(`Listening on ${server.url}`);
  return server;
}
