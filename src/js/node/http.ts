const { validateInteger } = require("internal/validators");
const { Agent, globalAgent, NODE_HTTP_WARNING } = require("node:_http_agent");
const { ClientRequest } = require("node:_http_client");
const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing");
const { Server, ServerResponse } = require("node:_http_server");

const { validateHeaderName, validateHeaderValue, METHODS, STATUS_CODES } = require("internal/http");

const { WebSocket, CloseEvent, MessageEvent } = globalThis;

function createServer(options, callback) {
  return new Server(options, callback);
}

/**
 * Makes an HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function request(url, options, cb) {
  return new ClientRequest(url, options, cb);
}

/**
 * Makes a `GET` HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function get(url, options, cb) {
  const req = request(url, options, cb);
  req.end();
  return req;
}

const setMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "setMaxHTTPHeaderSize", 1);
const getMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "getMaxHTTPHeaderSize", 0);

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
  setMaxIdleHTTPParsers(max) {
    validateInteger(max, "max", 1);
    $debug(`${NODE_HTTP_WARNING}\n`, "setMaxIdleHTTPParsers() is a no-op");
  },
  globalAgent,
  ClientRequest,
  OutgoingMessage,
  WebSocket,
  CloseEvent,
  MessageEvent,
};

export default http_exports;
