// @ts-nocheck
import React from "react";
import { PassThrough } from "node:stream";
import EventEmitter from "node:events";
import * as RSCServer from "react-server-dom-webpack/server";
import { createFromNodeStream } from "react-server-dom-webpack/client";
import type { SSRManifest } from "react-server-dom-webpack/client.node";

import { use } from "react" with { bun_kit_graph: 'ssr' };
import { renderToReadableStream } from "react-dom/server" with { bun_kit_graph: 'ssr' };
import { jsxDEV } from "react/jsx-dev-runtime" with { bun_kit_graph: 'ssr' };

const serverManifest = {
  'Client.tsx#Client': {
    id: 'Client.tsx',
    name: 'Client',
    chunks: [],
  },
};

export const clientManifest: SSRManifest = {
  moduleMap: {
    "Client.tsx": {
      Client: {
        name: 'Client',
        specifier: 'ssr:Client.tsx',
      },
    }
  },
  moduleLoading: {
    prefix: "",
  },
};

export default async function (request: {}, route_module: any): Promise<string> {
  const Route = route_module.default;
  const page = (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>React Server Components</title>
      </head>
      <body>
        <Route />
      </body>
    </html>
  );

  const rscPayloadIn = RSCServer.renderToPipeableStream(page, serverManifest);
  const rscPayload: PassThrough = rscPayloadIn.pipe(new PassThrough());

  const promise = createFromNodeStream(rscPayload, clientManifest);
  const Async = () => use(promise);
  const ssr = await renderToReadableStream(jsxDEV(Async, {}, undefined, false, undefined, this));
  const result = await Bun.readableStreamToText(ssr);
  return result;
}
