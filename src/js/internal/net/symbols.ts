export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  // tls.Server.prototype slot: node:http's TLS-mode Server registers the same listener.
  kTlsConnectionListener: Symbol("kTlsConnectionListener"),
  kVerifyError: Symbol("kVerifyError"),
};
