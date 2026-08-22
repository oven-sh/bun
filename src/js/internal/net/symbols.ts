export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  kVerifyError: Symbol("kVerifyError"),
  // Socket.prototype[kDetachHandle](): the socket gives up its native handle so
  // the descriptor can be passed to another process (child.send(message, socket)).
  kDetachHandle: Symbol("kDetachHandle"),
};
