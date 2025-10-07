import * as https from "https-browserify";
export var {
  Agent,
  ClientRequest,
  IncomingMessage,
  METHODS,
  OutgoingMessage,
  STATUS_CODES,
  Server,
  ServerResponse,
  createServer,
  get,
  globalAgent,
  maxHeaderSize,
  request,
  setMaxIdleHTTPParsers,
  validateHeaderName,
  validateHeaderValue,
} = https;

export default https;
