// The default framework of `bun bake` for `.tsx` and `.jsx` pages, with the project's own React.
// Bake bundles it into the server graph from the project root, so `react` resolves from the project.
// `react-dom/server.browser` has `renderToReadableStream` in React 18 and 19.
import { renderToReadableStream } from "react-dom/server.browser";

type Params = Record<string, string | string[]>;

/**
 * A page picks how it is rendered with these exports, named as in the Next.js pages router. In dev,
 * every page renders on every request. The browser copy of a page does not have them.
 */
type PageModule = {
  default?: (props: any) => any;
  getServerSideProps?: (ctx: { params: Params; request: Request }) => Promise<DataResult>;
  getStaticProps?: (ctx: { params: Params }) => Promise<DataResult>;
  getStaticPaths?: () => Promise<{ paths: { params: Params }[]; fallback: false | "blocking" }>;
};

type DataResult =
  | { props: Record<string, unknown>; revalidate?: number | false }
  | { notFound: true }
  | { redirect: { destination: string; permanent: boolean } };

type RouteMetadata = {
  pageModule: PageModule;
  layouts: ReadonlyArray<{ default?: (props: any) => any }>;
  params: null | Params;
  modules: ReadonlyArray<string>;
  modulepreload: ReadonlyArray<string>;
  styles: ReadonlyArray<string>;
};

function sameParams(a: Params, b: Params) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => {
    const x = a[key];
    const y = b[key];
    return Array.isArray(x) && Array.isArray(y) ? x.length === y.length && x.every((v, i) => v === y[i]) : x === y;
  });
}

const notFound = () => new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });

/**
 * How long a server may keep the page and send it again, as `Cache-Control` (as Next.js sets it): a
 * page with `getServerSideProps` never, one with `revalidate: N` for N seconds, and any other for a
 * year. `bun bake build`'s server keeps it in memory; `bun bake` renders every request.
 */
const keepForever = "s-maxage=31536000, stale-while-revalidate";
const keepNever = "private, no-cache, no-store, max-age=0, must-revalidate";

/** The props of the page and its `Cache-Control`, or the response that replaces it. */
async function loadData(
  page: PageModule,
  params: Params,
  request: Request,
): Promise<{ props: object; cacheControl: string } | Response> {
  let result: DataResult;
  let name: string;
  if (typeof page.getServerSideProps === "function") {
    if (typeof page.getStaticProps === "function") {
      throw new Error("A page cannot export both getServerSideProps and getStaticProps.");
    }
    name = "getServerSideProps";
    result = await page.getServerSideProps({ params, request });
  } else if (typeof page.getStaticProps === "function") {
    if (typeof page.getStaticPaths === "function") {
      const { paths, fallback } = await page.getStaticPaths();
      if (fallback === false && !paths.some(path => sameParams(path.params, params))) return notFound();
    }
    name = "getStaticProps";
    result = await page.getStaticProps({ params });
  } else {
    return { props: {}, cacheControl: keepForever };
  }
  if (result && typeof result === "object") {
    if ("props" in result) {
      let cacheControl = keepForever;
      if (name === "getServerSideProps") cacheControl = keepNever;
      else if (typeof result.revalidate === "number")
        cacheControl = `s-maxage=${result.revalidate}, stale-while-revalidate`;
      return { props: result.props, cacheControl };
    }
    if ("notFound" in result && result.notFound) return notFound();
    if ("redirect" in result && result.redirect) {
      const { destination, permanent } = result.redirect;
      return new Response(null, { status: permanent ? 308 : 307, headers: { location: destination } });
    }
  }
  throw new TypeError(`${name} must return { props }, { notFound: true } or { redirect: { destination, permanent } }.`);
}

export async function render(request: Request, meta: RouteMetadata): Promise<Response> {
  const page = meta.pageModule;
  const Page = page.default;
  // A function, or what memo(), forwardRef() and lazy() return: React checks the type.
  if (Page == null) {
    throw new TypeError("A page must have a default export: the React component of the page.");
  }
  const params = meta.params ?? {};
  const data = await loadData(page, params, request);
  if (data instanceof Response) return data;
  const { props, cacheControl } = data;

  let element = <Page params={params} {...props} />;
  // The first layout is the inner-most.
  for (const layout of meta.layouts) {
    const Layout = layout.default;
    if (Layout == null) {
      throw new TypeError("A layout must have a default export: the React component of the layout.");
    }
    element = <Layout params={params}>{element}</Layout>;
  }

  // `client.tsx` reads these to hydrate the same tree.
  const hydration = {
    params,
    props,
    hasData: page.getServerSideProps !== undefined || page.getStaticProps !== undefined,
  };
  const stream = await renderToReadableStream(
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {meta.styles.map(href => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {meta.modulepreload.map(href => (
          <link key={href} rel="modulepreload" href={href} />
        ))}
        {/* In <head>, so it is there before the browser bundle runs. */}
        <script
          id="__bun_bake_data"
          type="application/json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(hydration).replaceAll("<", "\\u003c") }}
        />
      </head>
      <body>
        <div id="root">{element}</div>
      </body>
    </html>,
    // React writes these with the shell, ahead of any pending Suspense boundary.
    { signal: request.signal, bootstrapModules: [...meta.modules] },
  );
  return new Response(stream, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": cacheControl },
  });
}
