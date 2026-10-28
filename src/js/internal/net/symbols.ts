export default {
  // The tls.Server that accepted this TLSSocket. Cleared by that server's 'connection' listener.
  kAcceptedTLS: Symbol("kAcceptedTLS"),
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Set while a socket must receive nothing (an idle socket in an http.Agent
  // pool): the read path destroys the socket instead of delivering the bytes.
  kDestroyOnRead: Symbol("kDestroyOnRead"),
  kPreHandshakeWrite: Symbol("kPreHandshakeWrite"),
  // net.Socket.prototype method for child_process: Node's handle.readStop().
  kReadStop: Symbol("kReadStop"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  // net.Server.prototype method: runs the server's SNICallback for one handshake. https.Server calls it for its own connections.
  kSelectSNIContext: Symbol("kSelectSNIContext"),
  // The error of an SNICallback, on the socket whose handshake it aborted, for 'tlsClientError'.
  kSNIError: Symbol("kSNIError"),
  // tls.Server's addContext() map of hostname to SecureContext. https.Server adds the entries to its own listener.
  kSNIContexts: Symbol("kSNIContexts"),
  // tls.TLSSocket.prototype getter: the native object with the connection's TLS members. It's `_handle`, except on an https.Server's sockets.
  kTLSHandle: Symbol("kTLSHandle"),
  kVerifyError: Symbol("kVerifyError"),
  // net.Socket.prototype method behind the client-side `new tls.TLSSocket(socket)`.
  kUpgradeClientTLS: Symbol("kUpgradeClientTLS"),
  // True on a client-side `new tls.TLSSocket(socket)`. The TLSSocket constructor sets it.
  kStandaloneWrap: Symbol("kStandaloneWrap"),

  // Registered symbols: other modules name them by their keys.
  bunTlsSymbol: Symbol.for("::buntls::"),
  bunSocketServerOptions: Symbol.for("::bunnetserveroptions::"),
  // On a tls.TLSSocket and a tls.Server: the constructor of the native SecureContext.
  kNativeSecureContextCtor: Symbol.for("::buntlsnativesecurecontextctor::"),
  // net.Socket.prototype method behind the server-side `new tls.TLSSocket(socket, { isServer: true })`.
  kUpgradeServerTLS: Symbol.for("::bunUpgradeServerTLS::"),

  constructors: { Socket: undefined },
} as unknown as {
  readonly kAcceptedTLS: unique symbol;
  readonly kArmHandshakeTimeout: unique symbol;
  readonly kDestroyOnRead: unique symbol;
  readonly kPreHandshakeWrite: unique symbol;
  readonly kReadStop: unique symbol;
  readonly kSecureConnectDone: unique symbol;
  readonly kSelectSNIContext: unique symbol;
  readonly kSNIError: unique symbol;
  readonly kSNIContexts: unique symbol;
  readonly kTLSHandle: unique symbol;
  readonly kVerifyError: unique symbol;
  readonly kUpgradeClientTLS: unique symbol;
  readonly kStandaloneWrap: unique symbol;
  readonly bunTlsSymbol: unique symbol;
  readonly bunSocketServerOptions: unique symbol;
  readonly kNativeSecureContextCtor: unique symbol;
  readonly kUpgradeServerTLS: unique symbol;
  readonly constructors: { Socket: $Node.SocketConstructor | undefined };
};
