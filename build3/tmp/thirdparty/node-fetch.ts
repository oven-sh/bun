var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/thirdparty/node-fetch.ts
import type * as s from "stream"

;

const { Headers, Request, Response: WebResponse, Blob, File = Blob, FormData } = globalThis as any;
const nativeFetch = Bun.fetch;

const { Readable } = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 39/*node:stream*/) || __intrinsic__createInternalModuleById(39/*node:stream*/));

class Response extends WebResponse {
  _body: any;

  get body() {
    return this._body ?? (this._body = Readable.fromWeb(super.body));
  }
}

/**
 * `node-fetch` works like the browser-fetch API, except it's a little more strict on some features,
 * and uses node streams instead of web streams.
 *
 * It's overall a positive on speed to override the implementation, since most people will use something
 * like `.json()` or `.text()`, which is faster in Bun's native fetch, vs `node-fetch` going
 * through `node:http`, a node stream, then processing the data.
 */
async function fetch(url: any, init?: RequestInit & { body?: any }) {
  // input node stream -> web stream
  let body: s.Readable | undefined = init?.body;
  if (body) {
    const chunks: any = [];
    if (body instanceof Readable) {
      // TODO: Bun fetch() doesn't support ReadableStream at all.
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      init = { ...init, body: new Blob(chunks) };
    }
  }

  const response = await nativeFetch(url, init);
  Object.setPrototypeOf(response, Response.prototype);
  return response;
}

class AbortError extends DOMException {
  constructor(message) {
    super(message, "AbortError");
  }
}

class FetchBaseError extends Error {
  type: string;

  constructor(message, type) {
    super(message);
    this.type = type;
  }
}

class FetchError extends FetchBaseError {
  constructor(message, type, systemError) {
    super(message, type);
    this.code = systemError?.code;
  }
}

function blobFrom(path, options) {
  return Promise.resolve(Bun.file(path, options));
}

function blobFromSync(path, options) {
  return Bun.file(path, options);
}

var fileFrom = blobFrom;
var fileFromSync = blobFromSync;

function isRedirect(code) {
  return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
}

$ = Object.assign(fetch, {
  AbortError,
  Blob,
  FetchBaseError,
  FetchError,
  File,
  FormData,
  Headers,
  Request,
  Response,
  blobFrom,
  blobFromSync,
  fileFrom,
  fileFromSync,
  isRedirect,
  fetch,
  default: fetch,
});
$$EXPORT$$($).$$EXPORT_END$$;
