/// <reference path="/Users/dave/code/bun/src/kit/kit.d.ts" />
import type { Kit } from "bun";
import React from "react";
// @ts-ignore
import { renderToReadableStream } from "react-server-dom-webpack/server.browser";
// @ts-ignore
import { renderToHtml } from 'bun-framework-rsc/ssr.tsx' with { bunKitGraph: 'ssr' };
import { serverManifest } from 'bun:kit/server';

export default async function (request: Request, route: any, meta: Kit.RouteMetadata): Promise<Response> {
  const Route = route.default;
  const page = (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Bun + React Server Components</title>
        {meta.styles.map(url => <link key={url} rel='stylesheet' href={url} />)}
      </head>
      <body>
        <Route />
      </body>
    </html>
  );

  // One is used to render SSR. The second is embedded into the output stream.
  const [rscPayload1, rscPayload2] = renderToReadableStream(page, serverManifest).tee();
  const rscPayloadBuffer = Bun.readableStreamToText(rscPayload1);

  const rw = new HTMLRewriter();
  rw.on('body', {
    element(element) {
      element.onEndTag(async(end) => {
        end.before(`<script id="rsc_payload" type="json">${
          await rscPayloadBuffer
        }</script>` + meta.scripts.map(url => `<script src=${JSON.stringify(url)}></script>`).join(''), { html: true});   
      });
    },
  });
  // TODO: readableStreamToText is needed due to https://github.com/oven-sh/bun/issues/14216
  return rw.transform(new Response(await Bun.readableStreamToText(await renderToHtml(rscPayload2)), {
    headers: {
      'Content-Type': 'text/html; charset=utf8',
    }
  }));
}
