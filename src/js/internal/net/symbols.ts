export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Set while a socket must receive nothing (an idle socket in an http.Agent
  // pool): the read path destroys the socket instead of delivering the bytes.
  kDestroyOnRead: Symbol("kDestroyOnRead"),
  kPreHandshakeWrite: Symbol("kPreHandshakeWrite"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
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
  readonly kArmHandshakeTimeout: unique symbol;
  readonly kDestroyOnRead: unique symbol;
  readonly kPreHandshakeWrite: unique symbol;
  readonly kSecureConnectDone: unique symbol;
  readonly kVerifyError: unique symbol;
  readonly kUpgradeClientTLS: unique symbol;
  readonly kStandaloneWrap: unique symbol;
  readonly bunTlsSymbol: unique symbol;
  readonly bunSocketServerOptions: unique symbol;
  readonly kNativeSecureContextCtor: unique symbol;
  readonly kUpgradeServerTLS: unique symbol;
  readonly constructors: { Socket: $Node.SocketConstructor | undefined };
};
