/**
 * Browser polyfill for the `"http"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */
import http from "stream-http";
export default http;
export var {
  //
  request,
  get,
  ClientRequest,
  IncomingMessage,
  Agent,
  globalAgent,
  STATUS_CODES,
  METHODS,
} = http;
