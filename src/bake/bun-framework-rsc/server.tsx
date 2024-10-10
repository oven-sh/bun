import type { Bake } from "bun";
import { renderToReadableStream } from "react-server-dom-webpack/server.browser";
import { renderToHtml } from "bun-framework-rsc/ssr.tsx" with { bunBakeGraph: "ssr" };
import { serverManifest } from "bun:bake/server";

// `server.tsx` exports a function to be used for handling user routes. It takes
// in the Request object, the route's module, and extra route metadata.
export default async function (request: Request, route: any, meta: Bake.RouteMetadata): Promise<Response> {
  // TODO: be able to signal to Bake that Accept may include this, so that
  // static pages can be pre-rendered both as RSC payload + HTML.

  // The framework generally has two rendering modes.
  // - Standard browser navigation
  // - Client-side navigation
  //
  // For React, this means we will always perform `renderToReadableStream` to
  // generate the RSC payload, but only generate HTML for the former of these
  // rendering modes. This is signaled by `client.tsx` via the `Accept` header.
  const skipSSR = request.headers.get("Accept")?.includes("text/x-component");

  const Route = route.default;
  const page = (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Bun + React Server Components</title>
        {meta.styles.map(url => (
          <link key={url} rel="stylesheet" href={url} />
        ))}
      </head>
      <body>
        <Route />
      </body>
    </html>
  );

  // This renders Server Components to a ReadableStream "RSC Payload"
  const rscPayload = renderToReadableStream(page, serverManifest);
  if (skipSSR) {
    return new Response(rscPayload, {
      status: 200,
      headers: { "Content-Type": "text/x-component" },
    });
  }

  // One straem is used to render SSR. The second is embedded into the html for browser hydration.
  // Note: This approach does not stream the response.
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
