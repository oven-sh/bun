// Hardcoded module "node:_tls_wrap"
// Mirrors node's lib/_tls_wrap.js: re-exports these four from node:tls and
// emits DEP0192 once when the module is first required.

const { TLSSocket, Server, createServer, connect } = require("node:tls");

process.emitWarning("The _tls_wrap module is deprecated. Use `node:tls` instead.", "DeprecationWarning", "DEP0192");

export default {
  TLSSocket,
  Server,
  createServer,
  connect,
};
