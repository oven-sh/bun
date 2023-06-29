import * as http from "node:http";
var request2 = function(input, options, cb) {
  if (input && typeof input === "object" && !(input instanceof URL))
    input.protocol ??= "https:";
  else if (typeof options === "object")
    options.protocol ??= "https:";
  return http.request(input, options, cb);
}, get = function(input, options, cb) {
  const req = request2(input, options, cb);
  return req.end(), req;
}, {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  maxHeaderSize,
  setMaxIdleHTTPParsers,
  globalAgent
} = http, defaultExport = {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  request: request2,
  get,
  maxHeaderSize,
  setMaxIdleHTTPParsers,
  globalAgent
};
var https_default = defaultExport;
export {
  setMaxIdleHTTPParsers,
  request2 as request,
  maxHeaderSize,
  globalAgent,
  get,
  https_default as default,
  createServer,
  ServerResponse,
  Server,
  STATUS_CODES,
  METHODS,
  IncomingMessage,
  Agent
};
