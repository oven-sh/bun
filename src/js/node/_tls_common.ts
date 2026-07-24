// Hardcoded module "node:_tls_common"

const { translatePeerCertificate } = require("internal/tls/common");

process.emitWarning("The _tls_common module is deprecated. Use `node:tls` instead.", "DeprecationWarning", "DEP0192");

export default {
  translatePeerCertificate,
};
