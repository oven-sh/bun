// Port of Node v26.3.0 lib/internal/inspector/network_http.js: translates the
// http client's diagnostics_channel events into inspector Network events.
const {
  kInspectorRequestId,
  kResourceType,
  getMonotonicTime,
  getNextRequestId,
  registerDiagnosticChannels,
  sniffMimeType,
} = require("internal/inspector/network");
const { Network } = require("node:inspector");
const EventEmitter = require("node:events");

const kRequestUrl = Symbol("kRequestUrl");

function isAbsoluteURLPath(path: unknown) {
  return typeof path === "string" && (path.startsWith("http://") || path.startsWith("https://"));
}

function getRequestURL(request: any, host: string) {
  if (isAbsoluteURLPath(request.path)) {
    return request.path;
  }
  return `${request.protocol}//${host}${request.path}`;
}

// Convert a Headers object (Map<string, number | string | string[]>) to a
// plain object (Map<string, string>).
function convertHeaderObject(headers: Record<string, unknown> = {}) {
  // The 'host' header that contains the host and port of the URL.
  let host: string | undefined;
  let charset: string | undefined;
  let mimeType: string | undefined;
  const dict: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    const value = headers[key];
    const lowerCasedKey = key.toLowerCase();
    if (lowerCasedKey === "host") {
      host = value as string;
    }
    if (lowerCasedKey === "content-type") {
      const result = sniffMimeType(value as string);
      charset = result.charset;
      mimeType = result.mimeType;
    }
    if (typeof value === "string") {
      dict[key] = value;
    } else if ($isArray(value)) {
      if (lowerCasedKey === "cookie") dict[key] = value.join("; ");
      // ChromeDevTools frontend treats 'set-cookie' as a special case
      // https://github.com/ChromeDevTools/devtools-frontend/blob/4275917f84266ef40613db3c1784a25f902ea74e/front_end/core/sdk/NetworkRequest.ts#L1368
      else if (lowerCasedKey === "set-cookie") dict[key] = value.join("\n");
      else dict[key] = value.join(", ");
    } else {
      dict[key] = String(value);
    }
  }
  return [dict, host, charset, mimeType] as const;
}

// https://chromedevtools.github.io/devtools-protocol/1-3/Network/#event-requestWillBeSent
function onClientRequestCreated({ request }: any) {
  request[kInspectorRequestId] = getNextRequestId();

  const { 0: headers, 1: host, 2: charset } = convertHeaderObject(request.getHeaders());
  const url = getRequestURL(request, host!);
  request[kRequestUrl] = url;

  Network.requestWillBeSent({
    requestId: request[kInspectorRequestId],
    timestamp: getMonotonicTime(),
    wallTime: Date.now(),
    charset,
    request: {
      url,
      method: request.method,
      headers,
    },
  });
}

// https://chromedevtools.github.io/devtools-protocol/1-3/Network/#event-loadingFailed
function onClientRequestError({ request, error }: any) {
  if (typeof request[kInspectorRequestId] !== "string") {
    return;
  }
  Network.loadingFailed({
    requestId: request[kInspectorRequestId],
    timestamp: getMonotonicTime(),
    type: kResourceType.Other,
    errorText: error.message,
  });
}

// https://chromedevtools.github.io/devtools-protocol/1-3/Network/#event-responseReceived
function onClientResponseFinish({ request, response }: any) {
  if (typeof request[kInspectorRequestId] !== "string") {
    return;
  }

  const { 0: headers, 2: charset, 3: mimeType } = convertHeaderObject(response.headers);

  Network.responseReceived({
    requestId: request[kInspectorRequestId],
    timestamp: getMonotonicTime(),
    type: kResourceType.Other,
    response: {
      url: request[kRequestUrl],
      status: response.statusCode,
      statusText: response.statusMessage ?? "",
      headers,
      mimeType,
      charset,
    },
  });

  // Unlike response.on('data', ...), this does not put the stream into
  // flowing mode.
  EventEmitter.prototype.on.$call(response, "data", (chunk: Uint8Array) => {
    Network.dataReceived({
      requestId: request[kInspectorRequestId],
      timestamp: getMonotonicTime(),
      dataLength: chunk.byteLength,
      encodedDataLength: chunk.byteLength,
      data: chunk,
    });
  });

  // Wait until the response body is consumed by user code.
  response.once("end", () => {
    Network.loadingFinished({
      requestId: request[kInspectorRequestId],
      timestamp: getMonotonicTime(),
    });
  });
}

export default registerDiagnosticChannels([
  ["http.client.request.created", onClientRequestCreated],
  ["http.client.request.error", onClientRequestError],
  ["http.client.response.finish", onClientResponseFinish],
]);
