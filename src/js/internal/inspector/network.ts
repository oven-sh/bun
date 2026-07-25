// Port of Node v26.3.0 lib/internal/inspector/network.js: shared helpers for
// the Network-domain instrumentation of the http/http2/fetch clients.
const { MIMEType } = require("internal/util/mime");

const kInspectorRequestId = Symbol("kInspectorRequestId");

// https://chromedevtools.github.io/devtools-protocol/1-3/Network/#type-ResourceType
const kResourceType = {
  __proto__: null,
  Document: "Document",
  Stylesheet: "Stylesheet",
  Image: "Image",
  Media: "Media",
  Font: "Font",
  Script: "Script",
  TextTrack: "TextTrack",
  XHR: "XHR",
  Fetch: "Fetch",
  Prefetch: "Prefetch",
  EventSource: "EventSource",
  WebSocket: "WebSocket",
  Manifest: "Manifest",
  SignedExchange: "SignedExchange",
  Ping: "Ping",
  CSPViolationReport: "CSPViolationReport",
  Preflight: "Preflight",
  Other: "Other",
};

// Monotonic seconds since an arbitrary origin, the timestamp unit CDP uses.
function getMonotonicTime() {
  return performance.now() / 1000;
}

const kMaxSafeInteger = Number.MAX_SAFE_INTEGER;
let requestId = 0;
function getNextRequestId() {
  if (requestId === kMaxSafeInteger) {
    requestId = 0;
  }
  return `node-network-event-${++requestId}`;
}

function sniffMimeType(contentType: string) {
  let mimeType: string;
  let charset: string;
  try {
    const mimeTypeObj = new MIMEType(contentType);
    mimeType = (mimeTypeObj.essence || "").toLowerCase();
    charset = (mimeTypeObj.params.get("charset") || "").toLowerCase();
  } catch {
    mimeType = "";
    charset = "";
  }

  return {
    __proto__: null,
    mimeType,
    charset,
  };
}

type ListenerPair = [string, (message: unknown) => void];

function registerDiagnosticChannels(listenerPairs: ListenerPair[]) {
  const dc = require("node:diagnostics_channel");
  function enable() {
    for (const { 0: channel, 1: listener } of listenerPairs) {
      dc.subscribe(channel, listener);
    }
  }

  function disable() {
    for (const { 0: channel, 1: listener } of listenerPairs) {
      dc.unsubscribe(channel, listener);
    }
  }

  return {
    enable,
    disable,
  };
}

export default {
  kInspectorRequestId,
  kResourceType,
  getMonotonicTime,
  getNextRequestId,
  registerDiagnosticChannels,
  sniffMimeType,
};
