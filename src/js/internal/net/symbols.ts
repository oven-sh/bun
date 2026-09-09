export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Set while a socket must receive nothing: the read path destroys it instead
  // of delivering the bytes. node:http's Agent sets it on an idle keep-alive
  // socket in its free pool, where unsolicited bytes would be parsed as the
  // start of the next request's response.
  kDestroyOnRead: Symbol("kDestroyOnRead"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  kVerifyError: Symbol("kVerifyError"),
};
