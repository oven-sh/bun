// Hardcoded module "node:_tls_common"
// Deprecated shim mirroring node's lib/_tls_common.js: re-exports the real
// implementations and warns on load.
// https://github.com/nodejs/node/blob/v26.3.0/lib/_tls_common.js
const { SecureContext, createSecureContext } = require("node:tls");

process.emitWarning("The _tls_common module is deprecated. Use `node:tls` instead.", "DeprecationWarning", "DEP0192");

// Translate some fields from the handle's C-friendly format into more idiomatic
// javascript object representations before passing them back to the user.  Can
// be used on any cert object, but changing the name would be semver-major.
function translatePeerCertificate(c) {
  if (!c) return null;

  if (c.issuerCertificate != null && c.issuerCertificate !== c) {
    c.issuerCertificate = translatePeerCertificate(c.issuerCertificate);
  }
  if (c.infoAccess != null) {
    const info = c.infoAccess;
    const parsed = (c.infoAccess = Object.create(null));

    // XXX: More key validation?
    info.replace(/([^\n:]*):([^\n]*)(?:\n|$)/g, (all, key, val) => {
      if (val.charCodeAt(0) === 0x22) {
        // The translatePeerCertificate function is only
        // used on internally created legacy certificate
        // objects, and any value that contains a quote
        // will always be a valid JSON string literal,
        // so this should never throw.
        val = JSON.parse(val);
      }
      if (key in parsed) parsed[key].push(val);
      else parsed[key] = [val];
    });
  }
  return c;
}

export default {
  SecureContext,
  createSecureContext,
  translatePeerCertificate,
};
