export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  kPreHandshakeWrite: Symbol("kPreHandshakeWrite"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  kVerifyError: Symbol("kVerifyError"),
};
