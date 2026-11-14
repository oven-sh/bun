// What the compiler reads in place of src/js/internal/net/symbols.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 545810421e80e12a58f3c76d29eeaaed34b78770b5ab8e77bf1f224f94e45afd.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

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
  // The socket that is pushing what its handle has read, and that chunk, while it does.
  readInProgress: { socket: undefined, chunk: undefined },

  // Registered symbols: other modules name them by their keys. `bun run` asks the registry for one where a module spells it, and a test that has
  // replaced Symbol.for hears that: in such a run the modules ask there too, and nothing is asked here.
  bunTlsSymbol: CAN_REPLACE_BUILT_IN_FUNCTIONS ? undefined : Symbol.for("::buntls::"),
  bunSocketServerOptions: CAN_REPLACE_BUILT_IN_FUNCTIONS ? undefined : Symbol.for("::bunnetserveroptions::"),
  // On a tls.TLSSocket and a tls.Server: the constructor of the native SecureContext.
  kNativeSecureContextCtor: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? undefined
    : Symbol.for("::buntlsnativesecurecontextctor::"),
  // net.Socket.prototype method behind the server-side `new tls.TLSSocket(socket, { isServer: true })`.
  kUpgradeServerTLS: CAN_REPLACE_BUILT_IN_FUNCTIONS ? undefined : Symbol.for("::bunUpgradeServerTLS::"),

  constructors: { Socket: undefined },
  resumeOfSocket: undefined,
} as unknown as {
  readonly kAcceptedTLS: unique symbol;
  readonly kArmHandshakeTimeout: unique symbol;
  readonly kDestroyOnRead: unique symbol;
  readonly kForeignListener: unique symbol;
  readonly kHandleClosed: unique symbol;
  readonly kPreHandshakeWrite: unique symbol;
  readonly kReadStop: unique symbol;
  readonly kSecureConnectDone: unique symbol;
  readonly kSNIError: unique symbol;
  readonly kSNIContexts: unique symbol;
  readonly kVerifyError: unique symbol;
  readonly kUpgradeClientTLS: unique symbol;
  readonly kStandaloneWrap: unique symbol;
  readonly readInProgress: { socket: unknown; chunk: unknown };
  readonly bunTlsSymbol: unique symbol;
  readonly bunSocketServerOptions: unique symbol;
  readonly kNativeSecureContextCtor: unique symbol;
  readonly kUpgradeServerTLS: unique symbol;
  readonly constructors: { Socket: $Node.SocketConstructor | undefined };
  resumeOfSocket: unknown;
};
