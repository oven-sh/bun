import { use } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFromNodeStream } from "react-server-dom-webpack/client";
import { clientManifest } from 'bun:kit/server';
import type { PassThrough } from 'node:stream';

export function renderToHtml(rscPayload: PassThrough): Promise<ReadableStream> {
  // TODO: this does not implement proper streaming
  const promise = createFromNodeStream(rscPayload, {
    moduleMap: clientManifest,
    moduleLoading: {
      prefix: ""
    }
  });
  const Async = () => use(promise);
  return renderToReadableStream(<Async />);
}
