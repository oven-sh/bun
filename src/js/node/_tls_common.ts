// Hardcoded module "node:_tls_common"
// Deprecated shim: re-exports the real impls and warns on load.
// https://github.com/nodejs/node/blob/v26.3.0/lib/_tls_common.js
const { SecureContext, createSecureContext } = require("node:tls");

process.emitWarning("The _tls_common module is deprecated. Use `node:tls` instead.", "DeprecationWarning", "DEP0192");

const { translatePeerCertificate } = require("internal/tls/common");

export default {
  SecureContext,
  createSecureContext,
  translatePeerCertificate,
};
