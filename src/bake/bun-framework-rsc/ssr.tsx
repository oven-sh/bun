// This file is loaded in the SSR graph, meaning the `react-server` condition is
// no longer set. This means we can import client components, using `react-dom`
// to perform SSR from the RSC payload.
import { use } from "react";
import { createFromReadableStream } from "react-server-dom-webpack/client.browser";
import { renderToReadableStream } from "react-dom/server";
import { clientManifest } from "bun:bake/server";

export function renderToHtml(rscPayload: ReadableStream): Promise<ReadableStream> {
  const promise = createFromReadableStream(rscPayload, {
    moduleMap: clientManifest,
    moduleLoading: { prefix: "" },
  });
  const Async = () => use(promise);
  return renderToReadableStream(<Async />);
}
