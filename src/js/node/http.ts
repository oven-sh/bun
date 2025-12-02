// Hardcoded module "node:http"
const { validateInteger } = require("internal/validators");
const { Agent, globalAgent } = require("node:_http_agent");
const { ClientRequest } = require("node:_http_client");
const { methods, parsers } = require("node:_http_common");
const { IncomingMessage } = require("node:_http_incoming");
const { validateHeaderName, validateHeaderValue, OutgoingMessage } = require("node:_http_outgoing");
const { _connectionListener, STATUS_CODES, Server, ServerResponse } = require("node:_http_server");
const { getLazy } = require("internal/shared");
const { getMaxHTTPHeaderSize } = require("internal/http");

function createServer(options, callback) {
  return new Server(options, callback);
}

function request(url, options, cb) {
  return new ClientRequest(url, options, cb);
}

function get(url, options, cb) {
  const req = request(url, options, cb);
  req.end();
  return req;
}

const exports = {
  _connectionListener,
  Agent,
  Server,
  METHODS: methods.toSorted(),
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  request,
  get,
  validateHeaderName,
  validateHeaderValue,
  setMaxIdleHTTPParsers(max) {
    validateInteger(max, "max", 1);
    parsers.max = max;
  },
  globalAgent,
  ClientRequest,
  OutgoingMessage,
  WebSocket,
  CloseEvent,
  MessageEvent,
};

Object.defineProperty(exports, "maxHeaderSize", {
  __proto__: null,
  configurable: true,
  enumerable: true,
  // get: getLazy(() => getOptionValue("--max-http-header-size")),
  get: getLazy(() => getMaxHTTPHeaderSize()),
});

export default exports;
