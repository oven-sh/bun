// In Node.js, lib/internal/http2/core.js is the http2 implementation and
// lib/http2.js re-exports from it. In Bun, the implementation lives in
// node/http2.ts; this module exposes the session/stream classes so that
// Node.js tests which require('internal/http2/core') see the same shapes.

const http2 = require("node:http2");
const { $data: internals } = http2;

export default {
  ClientHttp2Session: internals.ClientHttp2Session,
  ServerHttp2Session: internals.ServerHttp2Session,
  Http2Session: internals.Http2Session,
  Http2Stream: internals.Http2Stream,
  ServerHttp2Stream: internals.ServerHttp2Stream,
  ClientHttp2Stream: internals.ClientHttp2Stream,
  Http2ServerRequest: http2.Http2ServerRequest,
  Http2ServerResponse: http2.Http2ServerResponse,
  connect: http2.connect,
  createServer: http2.createServer,
  createSecureServer: http2.createSecureServer,
  getDefaultSettings: http2.getDefaultSettings,
  getPackedSettings: http2.getPackedSettings,
  getUnpackedSettings: http2.getUnpackedSettings,
  sensitiveHeaders: http2.sensitiveHeaders,
  constants: http2.constants,
};
