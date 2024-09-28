// @ts-ignore
import { use } from "react";
// @ts-ignore
import { createFromReadableStream } from "react-server-dom-webpack/client.browser";
// @ts-ignore
import { renderToReadableStream } from "react-dom/server";
// @ts-ignore
import { clientManifest } from 'bun:kit/server';

export function renderToHtml(rscPayload: ReadableStream): Promise<ReadableStream> {
  // TODO: this does not implement proper streaming
  const promise = createFromReadableStream(rscPayload, {
    moduleMap: clientManifest,
    moduleLoading: {
      prefix: ""
    }
  });
  const Async = () => use(promise);
  // @ts-ignore
  return renderToReadableStream(<Async />);
}
