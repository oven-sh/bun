import React from "react";
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-server-dom-webpack/server";
import { renderToHtml } from './ssr' with { bunKitGraph: 'ssr' };
import { serverManifest } from 'bun:kit/server';

export default async function (request: Request, route: any, meta: Kit.RouteMetadata): Promise<Response> {
  const Route = route.default;
  const page = (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>React Server Components</title>
        {meta.styles.map(url => <link rel='stylesheet' href={url} />)}
      </head>
      <body>
        <Route />
        {meta.scripts.map(url => <script src={url} />)}
      </body>
    </html>
  );

  const { pipe } = renderToPipeableStream(page, serverManifest);
  const rscPayload = pipe(new PassThrough());
  return new Response(await renderToHtml(rscPayload), {
    headers: {
      'Content-Type': 'text/html; charset=utf8',
    }
  });
}
