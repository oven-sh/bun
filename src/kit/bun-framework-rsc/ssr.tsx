/// <reference path="../kit.d.ts" />
import type { PassThrough } from 'node:stream';
// @ts-ignore
import { use } from "react";
// @ts-ignore
import { createFromNodeStream } from "react-server-dom-webpack/client";
import { renderToReadableStream } from "react-dom/server";
import { clientManifest } from 'bun:kit/server';

export function renderToHtml(rscPayload: PassThrough): Promise<ReadableStream> {
  // TODO: this does not implement proper streaming
  const promise = createFromNodeStream(rscPayload, {
    moduleMap: clientManifest,
    moduleLoading: {
      prefix: ""
    }
  });
  const Async = () => use(promise);
  // @ts-ignore
  return renderToReadableStream(<Async />);
}
