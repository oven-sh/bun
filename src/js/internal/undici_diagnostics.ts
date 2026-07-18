// Native-called helpers that publish the undici-compatible diagnostics_channel
// events for the built-in fetch() and WebSocket clients. APM tooling (dd-trace,
// @opentelemetry/instrumentation-undici, etc.) subscribes to these channels to
// trace outbound HTTP traffic and inject propagation headers.
//
// Reference:
//   https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md
//   undici/lib/core/diagnostics.js, undici/lib/core/request.js
const dc = require("node:diagnostics_channel");

const requestCreateChannel = dc.channel("undici:request:create");
const requestBodySentChannel = dc.channel("undici:request:bodySent");
const requestHeadersChannel = dc.channel("undici:request:headers");
const requestTrailersChannel = dc.channel("undici:request:trailers");
const requestErrorChannel = dc.channel("undici:request:error");
const clientSendHeadersChannel = dc.channel("undici:client:sendHeaders");
const clientBeforeConnectChannel = dc.channel("undici:client:beforeConnect");
const clientConnectedChannel = dc.channel("undici:client:connected");
const wsOpenChannel = dc.channel("undici:websocket:open");
const wsCloseChannel = dc.channel("undici:websocket:close");
const wsSocketErrorChannel = dc.channel("undici:websocket:socket_error");
const wsPingChannel = dc.channel("undici:websocket:ping");
const wsPongChannel = dc.channel("undici:websocket:pong");

// Bun has no exposed undici Connector; the field exists so consumers that probe
// `typeof connectParams.connector` see a function.
function connector() {}

// Undici publishes the same mutable `request` object across create → bodySent →
// headers → trailers/error, and instrumentation uses it as a WeakMap key to
// correlate spans. `addHeader` is the documented hook APM uses to inject
// `traceparent`/`x-datadog-*` headers during `undici:request:create`.
class DiagnosticsRequest {
  origin: string;
  method: string;
  path: string;
  headers: string[];
  completed: boolean;
  // populated by addHeader(); read back by native after `undici:request:create`
  _added: string[] | undefined;

  constructor(origin: string, method: string, path: string, headers: string[]) {
    this.origin = origin;
    this.method = method;
    this.path = path;
    this.headers = headers;
    this.completed = false;
    this._added = undefined;
  }

  addHeader(key: string, value: string) {
    key = `${key}`;
    value = `${value}`;
    $arrayPush(this.headers, key);
    $arrayPush(this.headers, value);
    let added = this._added;
    if (added === undefined) added = this._added = [];
    $arrayPush(added, key);
    $arrayPush(added, value);
    return this;
  }

  get throwOnError() {
    return false;
  }
}

function anyFetchSubscriber() {
  return (
    requestCreateChannel.hasSubscribers ||
    requestBodySentChannel.hasSubscribers ||
    requestHeadersChannel.hasSubscribers ||
    requestTrailersChannel.hasSubscribers ||
    requestErrorChannel.hasSubscribers ||
    clientSendHeadersChannel.hasSubscribers ||
    clientBeforeConnectChannel.hasSubscribers ||
    clientConnectedChannel.hasSubscribers
  );
}

function buildConnectParams(
  request: DiagnosticsRequest,
  host: string,
  hostname: string,
  protocol: string,
  port: string,
) {
  return {
    host,
    hostname,
    protocol,
    port,
    version: "h1",
    servername: null,
    localAddress: null,
    origin: request.origin,
  };
}

function onCreate(origin, method, path, host, hostname, protocol, port, headers) {
  if (!anyFetchSubscriber()) return null;
  const request = new DiagnosticsRequest(origin, method, path, $isJSArray(headers) ? headers : []);
  if (requestCreateChannel.hasSubscribers) {
    requestCreateChannel.publish({ request });
  }
  if (clientBeforeConnectChannel.hasSubscribers) {
    clientBeforeConnectChannel.publish({
      connectParams: buildConnectParams(request, host, hostname, protocol, port),
      connector,
    });
  }
  return request;
}

function onConnected(request, host, hostname, protocol, port) {
  if (!request) return;
  if (clientConnectedChannel.hasSubscribers) {
    clientConnectedChannel.publish({
      connectParams: buildConnectParams(request, host, hostname, protocol, port),
      connector,
      socket: null,
    });
  }
  if (clientSendHeadersChannel.hasSubscribers) {
    const h = request.headers;
    let header = `${request.method} ${request.path} HTTP/1.1\r\n`;
    if ($isJSArray(h)) {
      for (let i = 0; i + 1 < h.length; i += 2) header += `${h[i]}: ${h[i + 1]}\r\n`;
    }
    clientSendHeadersChannel.publish({ request, headers: header, socket: null });
  }
  if (requestBodySentChannel.hasSubscribers) {
    requestBodySentChannel.publish({ request });
  }
}

function onHeaders(request, statusCode, statusText, headers) {
  if (!request) return;
  if (requestHeadersChannel.hasSubscribers) {
    requestHeadersChannel.publish({
      request,
      response: { statusCode, statusText, headers: $isJSArray(headers) ? headers : [] },
    });
  }
}

function onComplete(request) {
  if (!request) return;
  request.completed = true;
  if (requestTrailersChannel.hasSubscribers) {
    requestTrailersChannel.publish({ request, trailers: [] });
  }
}

function onError(request, error) {
  if (!request) return;
  request.completed = true;
  if (requestErrorChannel.hasSubscribers) {
    requestErrorChannel.publish({ request, error });
  }
}

function wsOpen(websocket, protocol, extensions) {
  if (wsOpenChannel.hasSubscribers) {
    wsOpenChannel.publish({ address: undefined, protocol, extensions, websocket });
  }
}

function wsClose(websocket, code, reason) {
  if (wsCloseChannel.hasSubscribers) {
    wsCloseChannel.publish({ websocket, code, reason });
  }
}

function wsError(error) {
  if (wsSocketErrorChannel.hasSubscribers) {
    wsSocketErrorChannel.publish(error);
  }
}

function wsPing(payload) {
  if (wsPingChannel.hasSubscribers) wsPingChannel.publish({ payload });
}

function wsPong(payload) {
  if (wsPongChannel.hasSubscribers) wsPongChannel.publish({ payload });
}

export default {
  onCreate,
  onConnected,
  onHeaders,
  onComplete,
  onError,
  wsOpen,
  wsClose,
  wsError,
  wsPing,
  wsPong,
};
