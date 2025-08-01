// This file is loaded in the SSR graph, meaning the `react-server` condition is
// no longer set. This means we can import client components, using `react-dom`
// to perform Server-side rendering (creating HTML) out of the RSC payload.
import { ssrManifest } from "bun:bake/server";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import * as React from "react";
import { renderToPipeableStream } from "react-dom/server.node";
import { createFromNodeStream, type Manifest } from "react-server-dom-bun/client.node.unbundled.js";
import type { MiniAbortSignal } from "./server";

// Verify that React 19 is being used.
if (!React.use) {
  throw new Error("Bun's React integration requires React 19");
}

const createFromNodeStreamOptions: Manifest = {
  moduleMap: ssrManifest,
  moduleLoading: { prefix: "/" },
};

// The `renderToHtml` function not only implements converting the RSC payload
// into HTML via react-dom, but also streaming the RSC payload via injected
// script tags.  While the page is streaming, the client is loading the RSC
// payload in the `__bun_f` ('f' meaning flight) global. `client.tsx` can
// convert that array into a `ReadableStream` to incrementally hydrate the page.
//
// Some techniques have been taken from what Next.js and `rsc-html-stream` do,
// but this version is [1] uses more efficient streaming APIs and [2] streams
// the RSC data alongside the HTML, rather than injecting it at the very end.
//
// References:
// - https://github.com/vercel/next.js/blob/15.0.2/packages/next/src/server/app-render/use-flight-response.tsx
// - https://github.com/devongovett/rsc-html-stream
export function renderToHtml(
  rscPayload: Readable,
  bootstrapModules: readonly string[],
  signal: MiniAbortSignal,
): ReadableStream {
  // Bun supports a special type of readable stream type called "direct",
  // which provides a raw handle to the controller. We can bypass all of
  // the Web Streams API (slow) and use the controller directly.
  let stream: RscInjectionStream | null = null;
  let abort: () => void;
  return new ReadableStream({
    type: "direct",
    pull(controller) {
      // `createFromNodeStream` turns the RSC payload into a React component.
      const promise = createFromNodeStream(rscPayload, {
        // React takes in a manifest mapping client-side assets
        // to the imports needed for server-side rendering.
        moduleMap: ssrManifest,
        moduleLoading: { prefix: "/" },
      });
      // The root is this "Root" component that unwraps the streamed promise
      // with `use`, and then returning the parsed React component for the UI.
      const Root: any = () => React.use(promise);

      // `renderToPipeableStream` is what actually generates HTML.
      // Here is where React is told what script tags to inject.
      let pipe: (stream: any) => void;
      ({ pipe, abort } = renderToPipeableStream(<Root />, {
        bootstrapModules,
        onError(error) {
          if (!signal.aborted) {
            console.error(error);
          }
        },
      }));

      stream = new RscInjectionStream(rscPayload, controller);
      pipe(stream);

      // Promise resolved after all data is combined.
      return stream.finished;
    },
    cancel() {
      signal.aborted = true;
      signal.abort();
      abort?.();
    },
  } as Bun.DirectUnderlyingSource as any);
}

// Static builds can not stream suspense boundaries as they finish, but instead
// produce a single HTML blob. The approach is otherwise similar to `renderToHtml`.
export function renderToStaticHtml(rscPayload: Readable, bootstrapModules: readonly string[]): Promise<Blob> {
  const stream = new StaticRscInjectionStream(rscPayload);
  const promise = createFromNodeStream(rscPayload, createFromNodeStreamOptions);
  const Root = () => React.use(promise);
  const { pipe } = renderToPipeableStream(<Root />, {
    bootstrapModules,
    // Only begin flowing HTML once all of it is ready. This tells React
    // to not emit the flight chunks, just the entire HTML.
    onAllReady: () => pipe(stream),
  });
  return stream.result;
}

const closingBodyTag = "</body></html>";
const startScriptTag = "<script>(self.__bun_f||=[]).push(";
const continueScriptTag = "<script>__bun_f.push(";

const enum HtmlState {
  /** HTML is flowing, it is not an okay time to inject RSC data. */
  Flowing,
  /** It is safe to inject RSC data. */
  Boundary,
}

const enum RscState {
  /** No RSC data has been written yet */
  Waiting,
  /** Some but not all RSC data has been written */
  Paused,
  /** All RSC data has been written */
  Done,
}

class RscInjectionStream extends EventEmitter {
  controller: ReadableStreamDirectController;

  html: HtmlState = HtmlState.Flowing;
  rsc: RscState = RscState.Waiting;

  /** Chunks of RSC that will be injected at the next available point. */
  rscChunks: Uint8Array[] = [];
  /** If all RSC chunks have been processed */
  rscHasEnded = false;
  /** Shared state for decoding RSC data into UTF-8 strings */
  decoder = new TextDecoder("utf-8", { fatal: true });

  /** Resolved when all data is written */
  finished: Promise<void>;
  finalize: () => void;

  constructor(rscPayload: Readable, controller: ReadableStreamDirectController) {
    super();
    this.controller = controller;

    const { resolve, promise } = Promise.withResolvers<void>();
    this.finished = promise;
    this.finalize = resolve;

    rscPayload.on("data", this.writeRscData.bind(this));
    rscPayload.on("end", () => {
      this.rscHasEnded = true;
    });
  }

  write(data: Uint8Array) {
    if (import.meta.env.DEV && process.env.VERBOSE_SSR)
      console.write(
        "write" +
          Bun.inspect(
            {
              data: new TextDecoder().decode(data),
            },
            { colors: true },
          ) +
          "\n",
      );
    if (endsWithClosingScript(data)) {
      // The HTML is not done yet, but it's a suitible time to inject RSC data.
      const { controller } = this;
      controller.write(data);
      this.html = HtmlState.Boundary;
      this.drainRscChunks();
    } else if (endsWithClosingBody(data)) {
      // The HTML is about to finish. When this happens there cannot be more RSC
      // chunks, since if that was truly the case, the HTML wouldn't be done.
      const { controller } = this;
      controller.write(data.subarray(0, data.length - closingBodyTag.length));
      this.drainRscChunks();
      controller.write(closingBodyTag);
      controller.flush();
      this.finalize();
    } else {
      this.controller.write(data);
      this.html = HtmlState.Flowing;
    }
  }

  drainRscChunks() {
    const { rsc } = this;
    if (rsc === RscState.Done) return;

    const { controller, decoder, rscChunks } = this;
    if (rscChunks.length === 0) return;

    if (rsc === RscState.Waiting) {
      controller.write(startScriptTag);
    } else {
      controller.write(continueScriptTag);
      this.rsc = RscState.Paused;
    }
    writeManyFlightScriptData(rscChunks, decoder, controller);
    if (this.rscHasEnded) {
      this.rsc = RscState.Done;
    }
    this.rscChunks = [];
  }

  writeRscData(chunk: Uint8Array) {
    if (import.meta.env.DEV && process.env.VERBOSE_SSR)
      console.write(
        "writeRscData " +
          Bun.inspect(
            {
              data: new TextDecoder().decode(chunk),
            },
            { colors: true },
          ) +
          "\n",
      );

    if (this.html === HtmlState.Boundary) {
      const { controller, decoder } = this;
      if (this.rsc === RscState.Waiting) {
        controller.write(startScriptTag);
      } else {
        controller.write(continueScriptTag);
        this.rsc = RscState.Paused;
      }
      writeSingleFlightScriptData(chunk, decoder, controller);
    } else {
      this.rscChunks.push(chunk);
    }
  }

  flush() {
    // Ignore flush requests from React. Bun will automatically flush when reasonable.
  }

  destroy() {}

  end() {}
}

class StaticRscInjectionStream extends EventEmitter {
  rscPayloadChunks: Uint8Array[] = [];
  chunks: (Uint8Array | string)[] = [];
  result: Promise<Blob>;
  finalize: (blob: Blob) => void;
  reject: (error: Error) => void;

  constructor(rscPayload: Readable) {
    super();
    const { resolve, promise, reject } = Promise.withResolvers<Blob>();
    this.result = promise;
    this.finalize = resolve;
    this.reject = reject;

    rscPayload.on("data", chunk => this.rscPayloadChunks.push(chunk));
  }

  write(chunk) {
    this.chunks.push(chunk);
  }

  end() {
    // Inject the finalized RSC payload into the last chunk
    const lastChunk = this.chunks[this.chunks.length - 1];

    // Release assertions for React's behavior. If these break there will be malformed HTML.
    if (typeof lastChunk === "string") {
      this.destroy(new Error("The last chunk was expected to be a Uint8Array"));
      return;
    }
    if (!endsWithClosingBody(lastChunk)) {
      this.destroy(new Error("The last chunk did not end with a closing </body></html> tag"));
      return;
    }
    this.chunks[this.chunks.length - 1] = lastChunk.slice(0, lastChunk.length - closingBodyTag.length);

    let string = startScriptTag;
    writeManyFlightScriptData(this.rscPayloadChunks, new TextDecoder("utf-8"), { write: str => (string += str) });
    this.chunks.push(string + closingBodyTag);
    this.finalize(new Blob(this.chunks, { type: "text/html" }));
  }

  flush() {
    // Ignore flush requests from React.
  }

  destroy(error) {
    console.error(error);
    this.reject(error);
  }
}

/** Assumes the opening script tag and function call have been written */
function writeSingleFlightScriptData(
  chunk: Uint8Array,
  decoder: TextDecoder,
  controller: { write: (str: string) => void },
) {
  try {
    // `decode()` will throw on invalid UTF-8 sequences.
    controller.write("'" + toSingleQuote(decoder.decode(chunk, { stream: true })) + "')</script>");
  } catch {
    // The chunk cannot be embedded as a UTF-8 string in the script tag.
    // No data should have been written yet, so a base64 fallback can be used.
    const base64 = btoa(String.fromCodePoint(...chunk));
    controller.write(`Uint8Array.from(atob(\"${base64}\"),m=>m.codePointAt(0))</script>`);
  }
}

/**
 * Attempts to combine RSC chunks together to minimize the number of chunks the
 * client processes.
 */
function writeManyFlightScriptData(
  chunks: Uint8Array[],
  decoder: TextDecoder,
  controller: { write: (str: string) => void },
) {
  if (chunks.length === 1) return writeSingleFlightScriptData(chunks[0], decoder, controller);

  let i = 0;
  try {
    // Combine all chunks into a single string if possible.
    for (; i < chunks.length; i++) {
      // `decode()` will throw on invalid UTF-8 sequences.
      const str = toSingleQuote(decoder.decode(chunks[i], { stream: true }));
      if (i === 0) controller.write("'");
      controller.write(str);
    }
    controller.write("')</script>");
  } catch {
    // The chunk cannot be embedded as a UTF-8 string in the script tag.
    // Since this is rare, just make the rest of the chunks base64.
    if (i > 0) controller.write("');__bun_f.push(");
    controller.write('Uint8Array.from(atob("');
    for (; i < chunks.length; i++) {
      const chunk = chunks[i];
      const base64 = btoa(String.fromCodePoint(...chunk));
      controller.write(base64.slice(1, -1));
    }
    controller.write('"),m=>m.codePointAt(0))</script>');
  }
}

// Instead of using `JSON.stringify`, this uses a single quote variant of it, since
// the RSC payload includes a ton of " characters. This is slower, but an easy
// component to move into native code.
function toSingleQuote(str: string): string {
  return (
    str // Escape single quotes, backslashes, and newlines
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      // Escape closing script tags and HTML comments in JS content.
      .replace(/<!--/g, "<\\!--")
      .replace(/<\/(script)/gi, "</\\$1")
  );
}

// Note that the bundler special cases constant folding for `charCodeAt`.
function endsWithClosingScript(view: Uint8Array): boolean {
  const length = view.length;
  return (
    length >= 9 &&
    view[length - 9] === "<".charCodeAt(0) &&
    view[length - (9 - 1)] === "/".charCodeAt(0) &&
    view[length - (9 - 2)] === "s".charCodeAt(0) &&
    view[length - (9 - 3)] === "c".charCodeAt(0) &&
    view[length - (9 - 4)] === "r".charCodeAt(0) &&
    view[length - (9 - 5)] === "i".charCodeAt(0) &&
    view[length - (9 - 6)] === "p".charCodeAt(0) &&
    view[length - (9 - 7)] === "t".charCodeAt(0) &&
    view[length - (9 - 8)] === ">".charCodeAt(0)
  );
}

function endsWithClosingBody(view: Uint8Array): boolean {
  const length = view.length;
  return (
    length >= 14 &&
    view[length - 14] === "<".charCodeAt(0) &&
    view[length - (14 - 1)] === "/".charCodeAt(0) &&
    view[length - (14 - 2)] === "b".charCodeAt(0) &&
    view[length - (14 - 3)] === "o".charCodeAt(0) &&
    view[length - (14 - 4)] === "d".charCodeAt(0) &&
    view[length - (14 - 5)] === "y".charCodeAt(0) &&
    view[length - (14 - 6)] === ">".charCodeAt(0) &&
    view[length - (14 - 7)] === "<".charCodeAt(0) &&
    view[length - (14 - 8)] === "/".charCodeAt(0) &&
    view[length - (14 - 9)] === "h".charCodeAt(0) &&
    view[length - (14 - 10)] === "t".charCodeAt(0) &&
    view[length - (14 - 11)] === "m".charCodeAt(0) &&
    view[length - (14 - 12)] === "l".charCodeAt(0) &&
    view[length - (14 - 13)] === ">".charCodeAt(0)
  );
}
