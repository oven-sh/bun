// Hardcoded module "node:https"
import * as http from "node:http";

var {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  maxHeaderSize,
  validateHeaderName,
  validateHeaderValue,
  globalAgent,
} = http;

function request(input, options, cb) {
  if (input && typeof input === "object" && !(input instanceof URL)) {
    input.protocol ??= "https:";
  } else if (typeof options === "object") {
    options.protocol ??= "https:";
  }

  return http.request(input, options, cb);
}

function get(input, options, cb) {
  const req = request(input, options, cb);
  req.end();
  return req;
}

var defaultExport = {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  request,
  get,
  maxHeaderSize,
  validateHeaderName,
  validateHeaderValue,
  globalAgent,
};

export {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  request,
  get,
  maxHeaderSize,
  validateHeaderName,
  validateHeaderValue,
  globalAgent,
};
export default defaultExport;
