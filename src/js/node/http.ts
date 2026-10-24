const { validateInteger, validateObject } = require("internal/validators");
const httpAgent = require("node:_http_agent");
const { Agent } = require("node:_http_agent");
const { ClientRequest } = require("node:_http_client");
const { validateHeaderName, validateHeaderValue, parsers } = require("node:_http_common");
const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing");
const { Server, ServerResponse } = require("node:_http_server");

const { METHODS, STATUS_CODES, setMaxHTTPHeaderSize, getMaxHTTPHeaderSize } = require("internal/http");

if (process.env.NODE_DEBUG) require("node:util").debuglog("http");

const WebSocket = globalThis.WebSocket;
const CloseEvent = globalThis.CloseEvent;
const MessageEvent = globalThis.MessageEvent;

type ServerParameters = Parameters<typeof Server>;
type ClientRequestParameters = Parameters<typeof ClientRequest>;

function createServer(options?: ServerParameters[0], callback?: ServerParameters[1]): $Node.HttpServer {
  return new Server(options, callback);
}

/**
 * Makes an HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function request(
  url?: ClientRequestParameters[0],
  options?: ClientRequestParameters[1],
  cb?: ClientRequestParameters[2],
): $Node.ClientRequest {
  return new ClientRequest(url, options, cb);
}

/**
 * Makes a `GET` HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function get(url?: ClientRequestParameters[0], options?: ClientRequestParameters[1], cb?: ClientRequestParameters[2]) {
  const req = request(url, options, cb);
  req.end();
  return req;
}

const http_exports = {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  request,
  get,
  get maxHeaderSize() {
    return getMaxHTTPHeaderSize();
  },
  set maxHeaderSize(value) {
    setMaxHTTPHeaderSize(value);
  },
  validateHeaderName,
  validateHeaderValue,
  setMaxIdleHTTPParsers(max: number) {
    validateInteger(max, "max", 1);
    parsers.max = max;
  },
  setGlobalProxyFromEnv,
  // Assigning http.globalAgent must affect the agent used by http.request
  // (which reads it from the node:_http_agent module), like Node.js.
  get globalAgent() {
    return httpAgent.globalAgent;
  },
  set globalAgent(value) {
    httpAgent.globalAgent = value;
  },
  ClientRequest,
  OutgoingMessage,
  WebSocket,
  CloseEvent,
  MessageEvent,
};

function noopRestore() {}

// Port of Node.js's http.setGlobalProxyFromEnv() (lib/http.js):
// https://github.com/nodejs/node/blob/v26.3.0/lib/http.js
// Points the global http and
// https agents at the proxy servers configured through the given environment
// variables, returning a function that restores the previous agents.
// (The fetch() global dispatcher half is not applicable here.)
function setGlobalProxyFromEnv(env: Record<string, string | undefined> = process.env) {
  validateObject(env, "proxyEnv");
  const { parseProxyUrl, redactInvalidProxyUrl } = require("internal/http");
  const httpProxy = parseProxyUrl(env, "http:");
  const httpsProxy = parseProxyUrl(env, "https:");

  if (httpProxy === null && httpsProxy === null) {
    return noopRestore;
  }

  if (httpProxy !== null && URL.canParse(httpProxy) === false) {
    throw $ERR_PROXY_INVALID_CONFIG(redactInvalidProxyUrl(httpProxy));
  }
  if (httpsProxy !== null && URL.canParse(httpsProxy) === false) {
    throw $ERR_PROXY_INVALID_CONFIG(redactInvalidProxyUrl(httpsProxy));
  }

  let originalHttpsAgent: $Node.Agent | undefined, originalHttpAgent: $Node.Agent | undefined;
  if (httpProxy !== null) {
    originalHttpAgent = httpAgent.globalAgent;
    httpAgent.globalAgent = new Agent({
      keepAlive: true,
      scheduling: "lifo",
      timeout: 5000,
      proxyEnv: env,
    });
  }
  if (httpsProxy !== null) {
    const https = require("node:https");
    originalHttpsAgent = https.globalAgent;
    https.globalAgent = new https.Agent({
      keepAlive: true,
      scheduling: "lifo",
      timeout: 5000,
      proxyEnv: env,
    });
  }

  return function restore() {
    if (originalHttpAgent !== undefined) {
      httpAgent.globalAgent = originalHttpAgent;
    }
    if (originalHttpsAgent !== undefined) {
      require("node:https").globalAgent = originalHttpsAgent;
    }
  };
}

export default http_exports;
