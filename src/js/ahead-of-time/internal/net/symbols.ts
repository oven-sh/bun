// What the compiler reads in place of src/js/internal/net/symbols.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 eec4d2dfffa4dacbd7320c65df9ebf0be888c1720396a3c98746c10c3389d9a6.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

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
  resumeOfSocket: unknown;
};
