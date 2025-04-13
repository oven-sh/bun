'use strict';
const { validateInteger } = require('internal/validators');
const httpAgent = require('./_http_agent');
const { ClientRequest } = require('./_http_client');
const { methods, parsers } = require('./_http_common');
const { IncomingMessage } = require('./_http_incoming');
const {
  validateHeaderName,
  validateHeaderValue,
  OutgoingMessage,
} = require('./_http_outgoing');
const {
  _connectionListener,
  STATUS_CODES,
  Server,
  ServerResponse,
} = require('./_http_server');

const setMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "setMaxHTTPHeaderSize", 1);
const getMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "getMaxHTTPHeaderSize", 0);

function createServer(opts, requestListener) {
  return new Server(opts, requestListener);
}

function request(url, options, cb) {
  return new ClientRequest(url, options, cb);
}

function get(url, options, cb) {
  const req = request(url, options, cb);
  req.end();
  return req;
}

export default {
  _connectionListener,
  METHODS: methods.toSorted(),
  STATUS_CODES,
  Agent: httpAgent.Agent,
  ClientRequest,
  IncomingMessage,
  OutgoingMessage,
  Server,
  ServerResponse,
  createServer,
  validateHeaderName,
  validateHeaderValue,
  get,
  request,
  setMaxIdleHTTPParsers(max) {
    validateInteger(max, 'max', 1);
    parsers.max = max;
  },
  get maxHeaderSize() {
    return getMaxHTTPHeaderSize();
  },
  set maxHeaderSize(value) {
    setMaxHTTPHeaderSize(value);
  },
  get globalAgent() {
    return httpAgent.globalAgent;
  },
  set globalAgent(value) {
    httpAgent.globalAgent = value;
  },
  WebSocket,
  CloseEvent,
  MessageEvent,
};
