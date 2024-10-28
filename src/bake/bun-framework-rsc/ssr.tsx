// This file is loaded in the SSR graph, meaning the `react-server` condition is
// no longer set. This means we can import client components, using `react-dom`
// to perform SSR from the RSC payload.
import * as React from "react";
import { createFromReadableStream } from "react-server-dom-webpack/client.browser";
import { renderToReadableStream } from "react-dom/server";
import { clientManifest } from "bun:bake/server";

// Verify that React 19 is being used.
if (!React.use) {
  throw new Error("Bun's React integration requires React 19");
}

export function renderToHtml(rscPayload: ReadableStream): Promise<ReadableStream> {
  const promise = createFromReadableStream(rscPayload, {
    moduleMap: clientManifest,
    moduleLoading: { prefix: "" },
  });
  const Async = () => React.use(promise);
  return renderToReadableStream(<Async />);
}
