export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Set when a write reaches the TLS engine before the handshake completes.
  // Those bytes can only be framed once the handshake flight is out, so the
  // writable side's close_notify/FIN waits for the handshake (see
  // TLSSocket.prototype._final).
  kPreHandshakeWrite: Symbol("kPreHandshakeWrite"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  kVerifyError: Symbol("kVerifyError"),
};
