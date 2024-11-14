import type { Bake } from "bun";
import { renderToPipeableStream } from "react-server-dom-bun/server.node.unbundled.js";
import { renderToHtml, renderToStaticHtml } from "bun-framework-react/ssr.tsx" with { bunBakeGraph: "ssr" };
import { serverManifest } from "bun:bake/server";
import { PassThrough } from "node:stream";

function assertReactComponent(Component: any) {
  if (typeof Component !== "function") {
    console.log("Expected a React component", Component, typeof Component);
    throw new Error("Expected a React component");
  }
}

// This function converts the route information into a React component tree.
function getPage(meta: Bake.RouteMetadata) {
  const { styles } = meta;

  const Page = meta.pageModule.default;
  if (import.meta.env.DEV) assertReactComponent(Page);
  let route = <Page />;
  for (const layout of meta.layouts) {
    const Layout = layout.default;
    if (import.meta.env.DEV) assertReactComponent(Layout);
    route = <Layout>{route}</Layout>;
  }

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Bun + React Server Components</title>
        {styles.map(url => (
          <link key={url} rel="stylesheet" href={url} />
        ))}
      </head>
      <body>{route}</body>
    </html>
  );
}

// `server.tsx` exports a function to be used for handling user routes. It takes
// in the Request object, the route's module, and extra route metadata.
export async function render(request: Request, meta: Bake.RouteMetadata): Promise<Response> {
  // The framework generally has two rendering modes.
  // - Standard browser navigation
  // - Client-side navigation
  //
  // For React, this means we will always perform `renderToReadableStream` to
  // generate the RSC payload, but only generate HTML for the former of these
  // rendering modes. This is signaled by `client.tsx` via the `Accept` header.
  const skipSSR = request.headers.get("Accept")?.includes("text/x-component");

  const page = getPage(meta);

  // This renders Server Components to a ReadableStream "RSC Payload"
  const rscPayload = renderToPipeableStream(page, serverManifest)
    // TODO: write a lightweight version of PassThrough
    .pipe(new PassThrough());
  if (skipSSR) {
    return new Response(rscPayload as any, {
      status: 200,
      headers: { "Content-Type": "text/x-component" },
    });
  }

  // Then the RSC payload is rendered into HTML
  return new Response(await renderToHtml(rscPayload, meta.scripts), {
    headers: {
      "Content-Type": "text/html; charset=utf8",
    },
  });
}

// When a production build is performed, pre-rendering is invoked here. If this
// function returns no files, the route is always dynamic. When building an app
// to static files, all routes get pre-rendered (build failure if not possible).
export async function prerender(meta: Bake.RouteMetadata) {
  const page = getPage(meta);

  const rscPayload = renderToPipeableStream(page, serverManifest)
    // TODO: write a lightweight version of PassThrough
    .pipe(new PassThrough());

  let rscChunks: Uint8Array[] = [];
  rscPayload.on("data", chunk => rscChunks.push(chunk));

  const html = await renderToStaticHtml(rscPayload, meta.scripts);
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

// When a dynamic build uses static assets, Bun can map content types in the
// user's `Accept` header to the different static files.
export const contentTypeToStaticFile = {
  "text/html": "index.html",
  "text/x-component": "index.rsc",
};
