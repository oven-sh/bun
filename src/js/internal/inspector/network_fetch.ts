// Network-domain instrumentation for the global fetch(). Node instruments
// undici through its diagnostics_channel events; Bun's fetch is native and
// publishes none, so instead the global is swapped for a delegating wrapper
// while inspection is enabled (same pattern as node:inspector's console
// hooks). The events emitted mirror lib/internal/inspector/network_undici.js.
const { kResourceType, getMonotonicTime, getNextRequestId, sniffMimeType } = require("internal/inspector/network");
const { Network } = require("node:inspector");

// Captured at module load: instrumentation must keep working (and stay
// tamper-proof) if user code later replaces these globals.
const NativeRequest = globalThis.Request;
const NativeHeaders = globalThis.Headers;

let originalFetch: typeof fetch | undefined;
let instrumentedFetch: typeof fetch | undefined;

function headersToDictionary(headers: Headers) {
  const dict: Record<string, string> = {};
  let charset = "";
  let mimeType = "";
  for (const { 0: key, 1: value } of headers) {
    if (key === "set-cookie") continue;
    if (key === "content-type") {
      const result = sniffMimeType(value);
      charset = result.charset;
      mimeType = result.mimeType;
    }
    dict[key] = value;
  }
  // ChromeDevTools frontend treats 'set-cookie' as a special case
  // https://github.com/ChromeDevTools/devtools-frontend/blob/4275917f84266ef40613db3c1784a25f902ea74e/front_end/core/sdk/NetworkRequest.ts#L1368
  const setCookie = headers.getSetCookie();
  if (setCookie.length > 0) dict["set-cookie"] = setCookie.join("\n");
  return [dict, charset, mimeType] as const;
}

function emitRequestWillBeSent(requestId: string, input: unknown, init: any) {
  let url: string;
  let method: string | undefined;
  let headersInit: unknown;
  let hasPostData = false;

  if ($isObject(input) && input instanceof NativeRequest) {
    url = (input as Request).url;
    method = init?.method ?? (input as Request).method;
    headersInit = init?.headers ?? (input as Request).headers;
    hasPostData = init?.body != null || (input as Request).body != null;
  } else {
    url = `${input}`;
    method = init?.method;
    headersInit = init?.headers;
    hasPostData = init?.body != null;
  }
  try {
    url = new URL(url).href;
  } catch {}

  let headers: Record<string, string> = {};
  let charset = "";
  try {
    const { 0: dict, 1: requestCharset } = headersToDictionary(new NativeHeaders(headersInit as HeadersInit));
    headers = dict;
    charset = requestCharset;
  } catch {}

  Network.requestWillBeSent({
    requestId,
    timestamp: getMonotonicTime(),
    wallTime: Date.now(),
    charset,
    request: {
      url,
      method: typeof method === "string" && method.length > 0 ? method.toUpperCase() : "GET",
      headers,
      hasPostData,
    },
  });
  return url;
}

function emitLoadingFailed(requestId: string, error: unknown) {
  let errorText: string;
  try {
    errorText = `${(error as Error)?.message ?? error}`;
  } catch {
    errorText = "fetch failed";
  }
  Network.loadingFailed({
    requestId,
    timestamp: getMonotonicTime(),
    type: kResourceType.Fetch,
    errorText,
  });
}

function emitLoadingFinished(requestId: string) {
  Network.loadingFinished({
    requestId,
    timestamp: getMonotonicTime(),
  });
}

// Reads the response clone so the response body reaches the session's buffer
// (Network.getResponseBody) and loadingFinished fires once the body is
// complete, whether or not user code consumes its branch of the tee.
async function pumpResponseClone(requestId: string, body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    Network.dataReceived({
      requestId,
      timestamp: getMonotonicTime(),
      dataLength: value.byteLength,
      encodedDataLength: value.byteLength,
      data: value,
    });
  }
}

function emitResponseReceived(requestId: string, requestUrl: string, response: Response) {
  const { 0: headers, 1: charset, 2: mimeType } = headersToDictionary(response.headers);
  Network.responseReceived({
    requestId,
    timestamp: getMonotonicTime(),
    type: kResourceType.Fetch,
    response: {
      url: response.url || requestUrl,
      status: response.status,
      statusText: response.statusText,
      headers,
      mimeType,
      charset,
    },
  });

  let clonedBody: ReadableStream<Uint8Array> | null = null;
  try {
    if (response.body !== null && !response.bodyUsed) {
      clonedBody = response.clone().body;
    }
  } catch {}
  if (clonedBody === null) {
    emitLoadingFinished(requestId);
    return;
  }
  pumpResponseClone(requestId, clonedBody).then(
    () => emitLoadingFinished(requestId),
    (error: unknown) => emitLoadingFailed(requestId, error),
  );
}

function makeInstrumentedFetch(original: typeof fetch): typeof fetch {
  const wrapped = function fetch(input: unknown, init?: unknown) {
    const requestId = getNextRequestId();
    let requestUrl = "";
    // Instrumentation must never turn a working fetch into a throwing one.
    try {
      requestUrl = emitRequestWillBeSent(requestId, input, init);
    } catch {}
    let result: Promise<Response>;
    try {
      result = original.$call(globalThis, input, init);
    } catch (error) {
      emitLoadingFailed(requestId, error);
      throw error;
    }
    return result.then(
      (response: Response) => {
        try {
          emitResponseReceived(requestId, requestUrl, response);
        } catch {}
        return response;
      },
      (error: unknown) => {
        emitLoadingFailed(requestId, error);
        throw error;
      },
    );
  } as typeof fetch;
  // Bun's fetch carries additional properties (e.g. fetch.preconnect).
  try {
    Object.setPrototypeOf(wrapped, original);
  } catch {}
  return wrapped;
}

function enable() {
  if (instrumentedFetch !== undefined) return;
  const current = globalThis.fetch;
  if (typeof current !== "function") return;
  originalFetch = current;
  instrumentedFetch = makeInstrumentedFetch(current);
  globalThis.fetch = instrumentedFetch;
}

function disable() {
  if (instrumentedFetch === undefined) return;
  // Only restore a slot that still holds our wrapper.
  if (globalThis.fetch === instrumentedFetch) {
    globalThis.fetch = originalFetch!;
  }
  originalFetch = undefined;
  instrumentedFetch = undefined;
}

export default { enable, disable };
