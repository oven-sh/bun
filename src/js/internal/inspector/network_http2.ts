// Port of Node v26.3.0 lib/internal/inspector/network_http2.js: translates the
// http2 client's diagnostics_channel events into inspector Network events.
const {
  kInspectorRequestId,
  kResourceType,
  getMonotonicTime,
  getNextRequestId,
  registerDiagnosticChannels,
  sniffMimeType,
} = require("internal/inspector/network");
const { Network } = require("node:inspector");
const {
  HTTP2_HEADER_AUTHORITY,
  HTTP2_HEADER_CONTENT_TYPE,
  HTTP2_HEADER_COOKIE,
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_SCHEME,
  HTTP2_HEADER_SET_COOKIE,
  HTTP2_HEADER_STATUS,
  NGHTTP2_NO_ERROR,
} = require("node:http2").constants;
const EventEmitter = require("node:events");
const { Buffer } = require("node:buffer");

const kRequestUrl = Symbol("kRequestUrl");

// Convert a Headers object (Map<string, number | string | string[]>) to a
// plain object (Map<string, string>).
function convertHeaderObject(headers: Record<string, unknown> = {}) {
  let scheme: string | undefined;
  let authority: string | undefined;
  let path: string | undefined;
  let method: string | undefined;
  let statusCode: unknown;
  let charset: string | undefined;
  let mimeType: string | undefined;
  const dict: Record<string, string> = {};

  for (const key of Object.keys(headers)) {
    const value = headers[key];
    const lowerCasedKey = key.toLowerCase();

    if (lowerCasedKey === HTTP2_HEADER_SCHEME) {
      scheme = value as string;
    } else if (lowerCasedKey === HTTP2_HEADER_AUTHORITY) {
      authority = value as string;
    } else if (lowerCasedKey === HTTP2_HEADER_PATH) {
      path = value as string;
    } else if (lowerCasedKey === HTTP2_HEADER_METHOD) {
      method = value as string;
    } else if (lowerCasedKey === HTTP2_HEADER_STATUS) {
      statusCode = value;
    } else if (lowerCasedKey === HTTP2_HEADER_CONTENT_TYPE) {
      const result = sniffMimeType(value as string);
      charset = result.charset;
      mimeType = result.mimeType;
    }

    if (typeof value === "string") {
      dict[key] = value;
    } else if ($isArray(value)) {
      if (lowerCasedKey === HTTP2_HEADER_COOKIE) dict[key] = value.join("; ");
      // ChromeDevTools frontend treats 'set-cookie' as a special case
      // https://github.com/ChromeDevTools/devtools-frontend/blob/4275917f84266ef40613db3c1784a25f902ea74e/front_end/core/sdk/NetworkRequest.ts#L1368
      else if (lowerCasedKey === HTTP2_HEADER_SET_COOKIE) dict[key] = value.join("\n");
      else dict[key] = value.join(", ");
    } else {
      dict[key] = String(value);
    }
  }

  const url = `${scheme}://${authority}${path}`;

  return [dict, url, method, statusCode, charset, mimeType] as const;
}

// https://chromedevtools.github.io/devtools-protocol/1-3/Network/#event-requestWillBeSent
function onClientStreamCreated({ stream, headers }: any) {
  stream[kInspectorRequestId] = getNextRequestId();

  const { 0: convertedHeaderObject, 1: url, 2: method, 4: charset } = convertHeaderObject(headers);
  stream[kRequestUrl] = url;

  Network.requestWillBeSent({
    requestId: stream[kInspectorRequestId],
    timestamp: getMonotonicTime(),
    wallTime: Date.now(),
    charset,
    request: {
      url,
      method,
      headers: convertedHeaderObject,
      hasPostData: !stream.writableEnded,
    },
  });
}

// https://chromedevtools.github.io/devtools-protocol/1-3/Network/#event-loadingFailed
function onClientStreamError({ stream, error }: any) {
  if (typeof stream[kInspectorRequestId] !== "string") {
    return;
  }

  Network.loadingFailed({
    requestId: stream[kInspectorRequestId],
    timestamp: getMonotonicTime(),
    type: kResourceType.Other,
    errorText: error.message,
  });
}

// When a chunk of the request body is being sent, cache it until
// `getRequestPostData` request.
// https://chromedevtools.github.io/devtools-protocol/1-3/Network/#method-getRequestPostData
function onClientStreamBodyChunkSent({ stream, writev, data, encoding }: any) {
  if (typeof stream[kInspectorRequestId] !== "string") {
    return;
  }

  let chunk;

  if (writev) {
    if (data.allBuffers) {
      chunk = Buffer.concat(data);
    } else {
      const buffers: Buffer[] = [];
      for (let i = 0; i < data.length; ++i) {
        if (typeof data[i].chunk === "string") {
          buffers.push(Buffer.from(data[i].chunk, data[i].encoding));
        } else {
          buffers.push(data[i].chunk);
        }
      }
      chunk = Buffer.concat(buffers);
    }
  } else if (typeof data === "string") {
    chunk = Buffer.from(data, encoding);
  } else {
    chunk = data;
  }

  Network.dataSent({
    requestId: stream[kInspectorRequestId],
    timestamp: getMonotonicTime(),
    dataLength: chunk.byteLength,
    data: chunk,
  });
}

// Mark a request body as fully sent.
function onClientStreamBodySent({ stream }: any) {
  if (typeof stream[kInspectorRequestId] !== "string") {
    return;
  }

  Network.dataSent({
    requestId: stream[kInspectorRequestId],
    finished: true,
  });
}

// https://chromedevtools.github.io/devtools-protocol/1-3/Network/#event-responseReceived
function onClientStreamFinish({ stream, headers }: any) {
  if (typeof stream[kInspectorRequestId] !== "string") {
    return;
  }

  const { 0: convertedHeaderObject, 3: statusCode, 4: charset, 5: mimeType } = convertHeaderObject(headers);

  Network.responseReceived({
    requestId: stream[kInspectorRequestId],
    timestamp: getMonotonicTime(),
    type: kResourceType.Other,
    response: {
      url: stream[kRequestUrl],
      status: statusCode,
      statusText: "",
      headers: convertedHeaderObject,
      mimeType,
      charset,
    },
  });

  // Unlike stream.on('data', ...), this does not put the stream into flowing
  // mode.
  EventEmitter.prototype.on.$call(stream, "data", (chunk: Uint8Array) => {
    Network.dataReceived({
      requestId: stream[kInspectorRequestId],
      timestamp: getMonotonicTime(),
      dataLength: chunk.byteLength,
      encodedDataLength: chunk.byteLength,
      data: chunk,
    });
  });
}

// https://chromedevtools.github.io/devtools-protocol/1-3/Network/#event-loadingFinished
function onClientStreamClose({ stream }: any) {
  if (typeof stream[kInspectorRequestId] !== "string") {
    return;
  }

  if (stream.rstCode !== NGHTTP2_NO_ERROR) {
    // This is an error case, so only Network.loadingFailed should be emitted
    // which is already done by onClientStreamError().
    return;
  }

  Network.loadingFinished({
    requestId: stream[kInspectorRequestId],
    timestamp: getMonotonicTime(),
  });
}

export default registerDiagnosticChannels([
  ["http2.client.stream.created", onClientStreamCreated],
  ["http2.client.stream.error", onClientStreamError],
  ["http2.client.stream.finish", onClientStreamFinish],
  ["http2.client.stream.close", onClientStreamClose],
  ["http2.client.stream.bodyChunkSent", onClientStreamBodyChunkSent],
  ["http2.client.stream.bodySent", onClientStreamBodySent],
]);
