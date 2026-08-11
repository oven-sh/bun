export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  kVerifyError: Symbol("kVerifyError"),
  // net.Socket.prototype method driving the client-side upgrade behind
  // `new tls.TLSSocket(socket)`; lives in net.ts next to the connect() path it
  // shares with tls.connect({ socket }).
  kUpgradeClientTLS: Symbol("kUpgradeClientTLS"),
};
