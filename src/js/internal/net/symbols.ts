export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Set while a socket must receive nothing (an idle socket in an http.Agent
  // pool): the read path destroys the socket instead of delivering the bytes.
  kDestroyOnRead: Symbol("kDestroyOnRead"),
  kPreHandshakeWrite: Symbol("kPreHandshakeWrite"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  // What net.Socket#setKeepAlive() last gave to the handle. The delay is in milliseconds.
  kSetKeepAlive: Symbol("kSetKeepAlive"),
  kSetKeepAliveInitialDelay: Symbol("kSetKeepAliveInitialDelay"),
  // On a net.Socket subclass with no `_handle` (a node:http server socket): the handle that setKeepAlive() acts on.
  kSocketOptionHandle: Symbol("kSocketOptionHandle"),
  kVerifyError: Symbol("kVerifyError"),
  // net.Socket.prototype method behind the client-side `new tls.TLSSocket(socket)`.
  kUpgradeClientTLS: Symbol("kUpgradeClientTLS"),
  // True on a client-side `new tls.TLSSocket(socket)`. The TLSSocket constructor sets it.
  kStandaloneWrap: Symbol("kStandaloneWrap"),
};
