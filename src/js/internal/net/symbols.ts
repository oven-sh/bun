export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  kVerifyError: Symbol("kVerifyError"),
  // net.Socket.prototype method behind the client-side `new tls.TLSSocket(socket)`.
  kUpgradeClientTLS: Symbol("kUpgradeClientTLS"),
};
