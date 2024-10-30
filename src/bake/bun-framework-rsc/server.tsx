import type { Bake } from "bun";
import { renderToReadableStream } from "react-server-dom-webpack/server.browser";
import { renderToHtml } from "bun-framework-rsc/ssr.tsx" with { bunBakeGraph: "ssr" };
import { clientManifest, serverManifest } from "bun:bake/server";
import { join } from 'node:path';

function getPage(route, meta: Bake.RouteMetadata) {
  const Route = route.default;
  const { styles } = meta;

  if (import.meta.env.DEV) {
    if (typeof Route !== "function") {
      throw new Error(
        "Expected the default export of " +
          JSON.stringify(meta.devRoutePath) +
          " to be a React component, got " +
          JSON.stringify(Route),
      );
    }
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
      <body>
        <Route />
      </body>
    </html>
  );
}

// `server.tsx` exports a function to be used for handling user routes. It takes
// in the Request object, the route's module, and extra route metadata.
export default async function render(request: Request, route: any, meta: Bake.RouteMetadata): Promise<Response> {
  // The framework generally has two rendering modes.
  // - Standard browser navigation
  // - Client-side navigation
  //
  // For React, this means we will always perform `renderToReadableStream` to
  // generate the RSC payload, but only generate HTML for the former of these
  // rendering modes. This is signaled by `client.tsx` via the `Accept` header.
  const skipSSR = request.headers.get("Accept")?.includes("text/x-component");

  const page = getPage(route, meta);

  // This renders Server Components to a ReadableStream "RSC Payload"
  const rscPayload = renderToReadableStream(page, serverManifest);
  if (skipSSR) {
    return new Response(rscPayload, {
      status: 200,
      headers: { "Content-Type": "text/x-component" },
    });
  }

  // One straem is used to render SSR. The second is embedded into the html for browser hydration.
  // Note: This approach does not stream the response. That practice is called "react flight" and should be added
  const [rscPayload1, rscPayload2] = rscPayload.tee();
  const rscPayloadBuffer = Bun.readableStreamToText(rscPayload1);
  const rw = new HTMLRewriter();
  rw.on("body", {
    element(element) {
      element.onEndTag(async end => {
        end.before(
          `<script id="rsc_payload" type="json">${await rscPayloadBuffer}</script>` +
            meta.scripts.map(url => `<script src=${JSON.stringify(url)}></script>`).join(""),
          { html: true },
        );
      });
    },
  });
  // TODO: readableStreamToText is needed due to https://github.com/oven-sh/bun/issues/14216
  const output = await Bun.readableStreamToText(await renderToHtml(rscPayload2));
  return rw.transform(
    new Response(output, {
      headers: {
        "Content-Type": "text/html; charset=utf8",
      },
    }),
  );
}

// For static site generation, a different function is given, one without a request object.
export async function renderStatic(route: any, meta: Bake.RouteMetadata) {
  const page = getPage(route, meta);
  const rscPayload = renderToReadableStream(page, serverManifest);
  const [rscPayload1, rscPayload2] = rscPayload.tee();
  
  // Prepare both files in parallel
  let [html, rscPayloadBuffer] = await Promise.all([
    Bun.readableStreamToText(await renderToHtml(rscPayload2)),
    Bun.readableStreamToText(rscPayload1),
  ]);
  const scripts = meta.scripts.map(url => `<script src=${JSON.stringify(url)}></script>`);
  html = html.replace('</body>', `<script id="rsc_payload" type="json">${rscPayloadBuffer}</script>${scripts.join('\n')}</body>`);

  // Each route generates a directory with framework-provided files. Keys are
  // files relative to the route path, and values are anything `Bun.write`
  // supports. Streams may result in lower memory usage.
  return {
    // Directories like `blog/index.html` are preferred over `blog.html` because
    // certain static hosts do not support this conversion. By using `index.html`,
    // the static build is more portable.
    '/index.html': html,

    // The RSC payload is provided so client-side can use this file for seamless
    // client-side navigation. This is equivalent to 'Accept: text/x-component'
    // for the non-static build.s
    '/index.rsc': rscPayloadBuffer,
  }
}

// This is a hack to make react-server-dom-webpack work with Bun's bundler.
// It will be removed once Bun acquires react-server-dom-bun.
if (!import.meta.env.DEV) {
  globalThis.__webpack_require__ = (id: string) => {
    console.log("Bun: __webpack_require__", id);
    const y = import.meta.require(join(import.meta.dir, id));
    console.log({y});
    return y;
  };
}
