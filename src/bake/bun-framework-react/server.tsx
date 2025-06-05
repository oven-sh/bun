import type { Bake } from "bun";
import { renderToHtml, renderToStaticHtml } from "bun-framework-react/ssr.tsx" with { bunBakeGraph: "ssr" };
import { serverManifest } from "bun:bake/server";
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-server-dom-bun/server.node.unbundled.js";

function assertReactComponent(Component: any) {
  if (typeof Component !== "function") {
    console.log("Expected a React component", Component, typeof Component);
    throw new Error("Expected a React component");
  }
}

// This function converts the route information into a React component tree.
function getPage(meta: Bake.RouteMetadata, styles: readonly string[]) {
  let route = component(meta.pageModule, meta.params);
  for (const layout of meta.layouts) {
    const Layout = layout.default;
    if (import.meta.env.DEV) assertReactComponent(Layout);
    route = <Layout params={meta.params}>{route}</Layout>;
  }

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Bun + React Server Components</title>
        {styles.map(url => (
          // `data-bake-ssr` is used on the client-side to construct the styles array.
          <link key={url} rel="stylesheet" href={url} data-bake-ssr />
        ))}
      </head>
      <body>{route}</body>
    </html>
  );
}

function component(mod: any, params: Record<string, string> | null) {
  const Page = mod.default;
  let props = {};
  if (import.meta.env.DEV) assertReactComponent(Page);

  let method;
  if ((import.meta.env.DEV || import.meta.env.STATIC) && (method = mod.getStaticProps)) {
    if (mod.getServerSideProps) {
      throw new Error("Cannot have both getStaticProps and getServerSideProps");
    }

    props = method();
  }

  return <Page params={params} {...props} />;
}

// `server.tsx` exports a function to be used for handling user routes. It takes
// in the Request object, the route's module, and extra route metadata.
export async function render(request: Request, meta: Bake.RouteMetadata): Promise<Response> {
  // The framework generally has two rendering modes.
  // - Standard browser navigation
  // - Client-side navigation
  //
  // For React, this means calling `renderToReadableStream` to generate the RSC
  // payload, but only generate HTML for the former of these rendering modes.
  // This is signaled by `client.tsx` via the `Accept` header.
  const skipSSR = request.headers.get("Accept")?.includes("text/x-component");

  // Do not render <link> tags if the request is skipping SSR.
  const page = getPage(meta, skipSSR ? [] : meta.styles);

  // TODO: write a lightweight version of PassThrough
  const rscPayload = new PassThrough();

  if (skipSSR) {
    // "client.tsx" reads the start of the response to determine the
    // CSS files to load. The styles are loaded before the new page
    // is presented, to avoid a flash of unstyled content.
    const int = Buffer.allocUnsafe(4);
    const str = meta.styles.join("\n");
    int.writeUInt32LE(str.length, 0);
    rscPayload.write(int);
    rscPayload.write(str);
  }

  // This renders Server Components to a ReadableStream "RSC Payload"
  let pipe;
  const signal: MiniAbortSignal = { aborted: false, abort: null! };
  ({ pipe, abort: signal.abort } = renderToPipeableStream(page, serverManifest, {
    onError: err => {
      if (signal.aborted) return;
      console.error(err);
    },
    filterStackFrame: () => false,
  }));
  pipe(rscPayload);

  rscPayload.on("error", err => {
    if (signal.aborted) return;
    console.error(err);
  });

  if (skipSSR) {
    return new Response(rscPayload as any, {
      status: 200,
      headers: { "Content-Type": "text/x-component" },
    });
  }

  // The RSC payload is rendered into HTML
  return new Response(await renderToHtml(rscPayload, meta.modules, signal), {
    headers: {
      "Content-Type": "text/html; charset=utf8",
    },
  });
}

// When a production build is performed, pre-rendering is invoked here. If this
// function returns no files, the route is always dynamic. When building an app
// to static files, all routes get pre-rendered (build failure if not possible).
export async function prerender(meta: Bake.RouteMetadata) {
  const page = getPage(meta, meta.styles);

  const rscPayload = renderToPipeableStream(page, serverManifest)
    // TODO: write a lightweight version of PassThrough
    .pipe(new PassThrough());

  const int = new Uint32Array(1);
  int[0] = meta.styles.length;
  let rscChunks: Array<BlobPart> = [int.buffer as ArrayBuffer, meta.styles.join("\n")];
  rscPayload.on("data", chunk => rscChunks.push(chunk));

  const html = await renderToStaticHtml(rscPayload, meta.modules);
  const rsc = new Blob(rscChunks, { type: "text/x-component" });

  return {
    // Each route generates a directory with framework-provided files. Keys are
    // files relative to the route path, and values are anything `Bun.write`
    // supports. Streams may result in lower memory usage.
    files: {
      // Directories like `blog/index.html` are preferred over `blog.html` because
      // certain static hosts do not support this conversion. By using `index.html`,
      // the static build is more portable.
      "/index.html": html,

      // The RSC payload is provided so client-side can use this file for seamless
      // client-side navigation. This is equivalent to 'Accept: text/x-component'
      // for the non-static build.s
      "/index.rsc": rsc,
    },

    // In the future, it will be possible to return data for a partially
    // pre-rendered page instead of a fully rendered route. Bun might also
    // expose caching options here.
  };
}

export async function getParams(meta: Bake.ParamsMetadata): Promise<Bake.GetParamIterator> {
  const getStaticPaths = meta.pageModule.getStaticPaths;
  if (getStaticPaths == null) {
    if (import.meta.env.STATIC) {
      throw new Error(
        "In files with dynamic params, a `getStaticPaths` function must be exported to tell Bun what files to render.",
      );
    } else {
      return { pages: [], exhaustive: false };
    }
  }
  const result = await meta.pageModule.getStaticPaths();
  // Remap the Next.js pagess paradigm to Bun's format
  if (result.paths) {
    return {
      pages: result.paths.map(path => path.params),
    };
  }
  // Allow returning the array directly
  return result;
}

// When a dynamic build uses static assets, Bun can map content types in the
// user's `Accept` header to the different static files.
export const contentTypeToStaticFile = {
  "text/html": "index.html",
  "text/x-component": "index.rsc",
};

/** Instead of using AbortController, this is used */
export interface MiniAbortSignal {
  aborted: boolean;
  /** Caller must set `aborted` to true before calling. */
  abort: () => void;
}
