// Users may override the global fetch implementation, so we need to ensure these are the originals.
const bindings = $cpp("NodeFetch.cpp", "createNodeFetchInternalBinding");
const WebResponse: typeof globalThis.Response = bindings[0];
const WebRequest: typeof globalThis.Request = bindings[1];
const Blob: typeof globalThis.Blob = bindings[2];
const WebHeaders: typeof globalThis.Headers = bindings[3];
const FormData: typeof globalThis.FormData = bindings[4];
const File: typeof globalThis.File = bindings[5];
const nativeFetch = Bun.fetch;

// node-fetch extends from URLSearchParams in their implementation...
// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/headers.js#L44
class Headers extends WebHeaders {
  raw() {
    const obj = this.toJSON();
    for (const key in obj) {
      const val = obj[key];
      if (!$isJSArray(val)) {
        // They must all be arrays.
        obj[key] = [val];
      }
    }

    return obj;
  }

  // node-fetch inherits this due to URLSearchParams.
  // it also throws if you try to use it.
  sort() {
    throw new TypeError("Expected this to be instanceof URLSearchParams");
  }
}

const kHeaders = Symbol("kHeaders");
const kBody = Symbol("kBody");
const kUrl = Symbol("kUrl");
const HeadersPrototype = Headers.prototype;

class Response extends WebResponse {
  [kBody]: any;
  [kHeaders];
  [kUrl]?: string;

  constructor(body, init) {
    const { Readable, Stream } = require("node:stream");
    if (body && typeof body === "object" && (body instanceof Stream || body instanceof Readable)) {
      body = Readable.toWeb(body);
    }

    super(body, init);
    if (init && typeof init.url === "string") this[kUrl] = init.url;
  }

  get url() {
    return this[kUrl] ?? super.url;
  }

  get body() {
    let body = this[kBody];
    if (!body) {
      var web = super.body;
      if (!web) return null;
      body = this[kBody] = new (require("internal/webstreams_adapters")._ReadableFromWeb)({}, web);
    }

    return body;
  }

  get headers() {
    return (this[kHeaders] ??= Object.setPrototypeOf(super.headers, HeadersPrototype) as any);
  }

  clone() {
    return Object.setPrototypeOf(super.clone(this), ResponsePrototype);
  }

  async arrayBuffer() {
    // load the getter
    void this.body;
    return await super.arrayBuffer();
  }

  async blob() {
    // load the getter
    void this.body;
    return await super.blob();
  }

  async formData() {
    // load the getter
    void this.body;
    return await super.formData();
  }

  async json() {
    // load the getter
    void this.body;
    return await super.json();
  }

  // This is a deprecated function in node-fetch
  // but is still used by some libraries and frameworks (like Astro)
  async buffer() {
    // load the getter
    void this.body;
    return new $Buffer(await super.arrayBuffer());
  }

  async text() {
    // load the getter
    void this.body;
    return await super.text();
  }

  get type() {
    if (!super.ok) {
      return "error";
    }

    return "default";
  }
}
var ResponsePrototype = Response.prototype;

class Request extends WebRequest {
  [kUrl]?: string;

  constructor(input, init) {
    // node-fetch is relaxed with the URL, for example, it allows "/" as a valid URL.
    // If it's not a valid URL, use a placeholder URL during construction.
    // See: https://github.com/oven-sh/bun/issues/4947
    if (typeof input === "string" && !URL.canParse(input)) {
      super(new URL(input, "http://localhost/"), init);
      this[kUrl] = input;
    } else {
      super(input, init);
    }
  }

  get url() {
    return this[kUrl] ?? super.url;
  }
}

const FOLLOW_MAX_DEFAULT = 20;

/**
 * node-fetch's `agent` option cannot be expressed through native fetch, so when it's
 * set the request is driven by node:http / node:https (which honour `agent.addRequest`
 * / `createConnection`). The surface here mirrors what node-fetch itself does.
 */
function fetchWithAgent(url, init, counter) {
  return new Promise((resolve, reject) => {
    const http = require("node:http");
    const https = require("node:https");
    const { Readable, PassThrough, pipeline } = require("node:stream");
    const zlib = require("node:zlib");

    let href: string;
    let parsed: URL;
    try {
      href = url instanceof WebRequest ? url.url : url instanceof URL ? url.href : String(url);
      parsed = new URL(href);
    } catch {
      reject(new TypeError(`Only absolute URLs are supported. Received: ${url}`));
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      reject(new TypeError(`Only HTTP(S) protocols are supported. Received: ${parsed.protocol}`));
      return;
    }

    let agent = init.agent;
    if ($isCallable(agent)) agent = agent.$call(undefined, parsed);

    const method = (init.method || (url instanceof WebRequest && url.method) || "GET").toUpperCase();
    const compress = init.compress !== false;
    const redirect = init.redirect || "follow";
    const follow = typeof init.follow === "number" ? init.follow : FOLLOW_MAX_DEFAULT;
    const signal = init.signal;

    const headers = new Headers(init.headers || (url instanceof WebRequest && url.headers) || undefined);
    if (!headers.has("accept")) headers.set("accept", "*/*");
    if (compress && !headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, deflate, br");
    if (!headers.has("connection") && !agent) headers.set("connection", "close");

    let body = init.body ?? (url instanceof WebRequest ? url.body : null);
    if (body != null && (method === "GET" || method === "HEAD")) {
      reject(new TypeError("Request with GET/HEAD method cannot have body"));
      return;
    }

    let blobPromise: Promise<ArrayBuffer> | undefined;
    if (body != null && typeof body === "object") {
      if (body instanceof URLSearchParams) {
        if (!headers.has("content-type"))
          headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
        body = body.toString();
      } else if (body instanceof FormData) {
        // Let the native encoder produce the multipart body + boundary.
        const encoded = new WebResponse(body);
        const ct = encoded.headers.get("content-type");
        if (ct && !headers.has("content-type")) headers.set("content-type", ct);
        blobPromise = encoded.arrayBuffer();
        body = null;
      } else if (body instanceof Blob) {
        const bodyType = body.type;
        if (bodyType && !headers.has("content-type")) headers.set("content-type", bodyType);
      }
    }
    if (body != null && !headers.has("content-length") && !headers.has("transfer-encoding")) {
      if (typeof body === "string") headers.set("content-length", String(Buffer.byteLength(body)));
      else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        headers.set("content-length", String((body as ArrayBufferView).byteLength ?? (body as ArrayBuffer).byteLength));
      } else if (body instanceof Blob) headers.set("content-length", String(body.size));
    }

    const requestOpts = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: headers.toJSON(),
      agent,
    };

    const send = parsed.protocol === "https:" ? https.request : http.request;
    const req = send(requestOpts);
    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      const err: any = new DOMException("The operation was aborted.", "AbortError");
      err.type = "aborted";
      reject(err);
      req.destroy();
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("error", err => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new FetchError(`request to ${href} failed, reason: ${err.message}`, "system", err));
    });

    req.on("response", (res: any) => {
      if (settled) return;
      if (signal) signal.removeEventListener("abort", onAbort);

      const responseHeaders = new Headers();
      const rawHeaders: string[] = res.rawHeaders;
      for (let i = 0; i < rawHeaders.length; i += 2) {
        responseHeaders.append(rawHeaders[i], rawHeaders[i + 1]);
      }

      const status: number = res.statusCode;
      if (isRedirect(status)) {
        const location = responseHeaders.get("location");
        let locationURL: string | null = null;
        if (location !== null) {
          try {
            locationURL = new URL(location, href).href;
          } catch {
            if (redirect !== "manual") {
              settled = true;
              res.resume();
              reject(
                new FetchError(`uri requested responds with an invalid redirect URL: ${location}`, "invalid-redirect"),
              );
              return;
            }
          }
        }
        if (redirect === "error") {
          settled = true;
          res.resume();
          reject(
            new FetchError(
              `uri requested responds with a redirect, redirect mode is set to error: ${href}`,
              "no-redirect",
            ),
          );
          return;
        }
        if (redirect === "follow" && locationURL !== null) {
          if (counter >= follow) {
            settled = true;
            res.resume();
            reject(new FetchError(`maximum redirect reached at: ${href}`, "max-redirect"));
            return;
          }
          const nextHeaders = new Headers(init.headers || undefined);
          const nextInit: any = { ...init, counter: counter + 1, headers: nextHeaders };
          const nextURL = new URL(locationURL);
          if (nextURL.hostname !== parsed.hostname || nextURL.protocol !== parsed.protocol) {
            for (const name of ["authorization", "www-authenticate", "cookie", "cookie2"]) nextHeaders.delete(name);
          }
          if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
            nextInit.method = "GET";
            nextInit.body = undefined;
            nextHeaders.delete("content-length");
            nextHeaders.delete("content-type");
          } else if (body != null && typeof body === "object" && typeof (body as any).pipe === "function") {
            settled = true;
            res.resume();
            reject(new FetchError("Cannot follow redirect with body being a readable stream", "unsupported-redirect"));
            return;
          }
          settled = true;
          res.resume();
          resolve(fetchWithAgent(locationURL, nextInit, counter + 1));
          return;
        }
        // redirect === "manual" or no location: fall through and return the 3xx response as-is.
      }

      let raw: any = res.pipe(new PassThrough());
      const codings = (responseHeaders.get("content-encoding") || "").toLowerCase();
      if (compress && method !== "HEAD" && status !== 204 && status !== 304) {
        let decoder: any;
        if (codings === "gzip" || codings === "x-gzip")
          decoder = zlib.createGunzip({ flush: zlib.Z_SYNC_FLUSH, finishFlush: zlib.Z_SYNC_FLUSH });
        else if (codings === "deflate" || codings === "x-deflate")
          decoder = zlib.createInflate({ flush: zlib.Z_SYNC_FLUSH, finishFlush: zlib.Z_SYNC_FLUSH });
        else if (codings === "br") decoder = zlib.createBrotliDecompress();
        if (decoder) {
          const out = new PassThrough();
          pipeline(raw, decoder, out, () => {});
          raw = out;
          responseHeaders.delete("content-encoding");
          responseHeaders.delete("content-length");
        }
      }

      settled = true;
      const response = new Response(status === 204 || status === 304 || method === "HEAD" ? null : raw, {
        status,
        statusText: res.statusMessage || "",
        headers: responseHeaders,
        url: href,
      });
      if (counter > 0) Object.defineProperty(response, "redirected", { value: true, configurable: true });
      resolve(response);
    });

    const sendBuffered = (p: Promise<ArrayBuffer>) =>
      p.then(
        buf => req.end(new Uint8Array(buf)),
        err => {
          if (!settled) {
            settled = true;
            reject(new FetchError(`request to ${href} failed, reason: ${err.message}`, "system", err));
          }
          req.destroy(err);
        },
      );

    if (blobPromise) {
      sendBuffered(blobPromise);
    } else if (body == null) {
      req.end();
    } else if (typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      req.end(body instanceof ArrayBuffer ? new Uint8Array(body) : body);
    } else if (body instanceof Blob) {
      sendBuffered(body.arrayBuffer());
    } else if (typeof (body as any).pipe === "function") {
      (body as any).pipe(req);
    } else if (typeof (body as any).getReader === "function") {
      Readable.fromWeb(body as any).pipe(req);
    } else {
      req.end(String(body));
    }
  });
}

/**
 * `node-fetch` works like the browser-fetch API, except it's a little more strict on some features,
 * and uses node streams instead of web streams.
 *
 * It's overall a positive on speed to override the implementation, since most people will use something
 * like `.json()` or `.text()`, which is faster in Bun's native fetch, vs `node-fetch` going
 * through `node:http`, a node stream, then processing the data.
 */
async function fetch(
  // eslint-disable-next-line no-unused-vars
  url: any,

  // eslint-disable-next-line no-unused-vars
  init?: RequestInit & { body?: any; agent?: any; compress?: boolean; follow?: number; counter?: number },
) {
  // Native fetch has no `agent`; when one is supplied, fall back to the
  // node:http path so custom agents (proxy agents, overridden
  // createConnection, pooling) are actually used.
  if (init != null && init.agent != null && init.agent !== false) {
    return fetchWithAgent(url, init, init.counter || 0);
  }
  // Convert Node.js streams to Web ReadableStream if they don't have Symbol.asyncIterator.
  // This is needed for libraries like `form-data` that use CombinedStream which extends
  // Node.js Stream but doesn't implement Symbol.asyncIterator.
  const initBody = init?.body;
  if (initBody && typeof initBody === "object" && !initBody[Symbol.asyncIterator]) {
    const { Readable, Stream, PassThrough } = require("node:stream");
    if (initBody instanceof Stream || initBody instanceof Readable) {
      // For old-style streams that don't have asyncIterator (like CombinedStream used by form-data),
      // pipe through a PassThrough stream to convert to a Readable that can be converted to a web stream.
      let readable = initBody;
      if (!(readable instanceof Readable)) {
        const passthrough = new PassThrough();
        readable.pipe(passthrough);
        readable = passthrough;
      }
      init = { ...init, body: Readable.toWeb(readable) };
    }
  }
  const response = await nativeFetch.$call(undefined, url, init);
  Object.setPrototypeOf(response, ResponsePrototype);
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
  return Promise.$resolve(Bun.file(path, options));
}

function blobFromSync(path, options) {
  return Bun.file(path, options);
}

var fileFrom = blobFrom;
var fileFromSync = blobFromSync;

function isRedirect(code) {
  return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
}

export default Object.assign(fetch, {
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
