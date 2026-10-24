export default {
  // The tls.Server that accepted this TLSSocket. Cleared by that server's 'connection' listener.
  kAcceptedTLS: Symbol("kAcceptedTLS"),
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Set while a socket must receive nothing (an idle socket in an http.Agent
  // pool): the read path destroys the socket instead of delivering the bytes.
  kDestroyOnRead: Symbol("kDestroyOnRead"),
  // net.Server.prototype method. node:http calls it on its own server, whose connections uWS accepts.
  kForeignListener: Symbol("kForeignListener"),
  // A function that node:http puts on a socket it handed to 'connect' or 'upgrade'. net.Socket calls it when the connection has closed.
  kHandleClosed: Symbol("kHandleClosed"),
  // How many bytes the kernel had taken when net.Socket's timer last found a write queue that moved.
  kLastBytesSent: Symbol("kLastBytesSent"),
  kPreHandshakeWrite: Symbol("kPreHandshakeWrite"),
  // net.Socket.prototype method for child_process: Node's handle.readStop().
  kReadStop: Symbol("kReadStop"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  // The error of an SNICallback, on the socket whose handshake it aborted, for 'tlsClientError'.
  kSNIError: Symbol("kSNIError"),
  // tls.Server's addContext() map of hostname to SecureContext. https.Server adds the entries to its own listener.
  kSNIContexts: Symbol("kSNIContexts"),
  kVerifyError: Symbol("kVerifyError"),
  // net.Socket.prototype method behind the client-side `new tls.TLSSocket(socket)`.
  kUpgradeClientTLS: Symbol("kUpgradeClientTLS"),
  // True on a client-side `new tls.TLSSocket(socket)`. The TLSSocket constructor sets it.
  kStandaloneWrap: Symbol("kStandaloneWrap"),
};
