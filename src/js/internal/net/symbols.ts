export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  // tls.Server.prototype slot for Node's tlsConnectionListener. node:http's TLS-mode Server (an
  // https.Server, a tls.Server in Node but not here) registers the same listener through it.
  kTlsConnectionListener: Symbol("kTlsConnectionListener"),
  kVerifyError: Symbol("kVerifyError"),
};
