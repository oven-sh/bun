export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  kVerifyError: Symbol("kVerifyError"),
  // Set once a TLS layer owns this net.Socket's bytes: node:net's data handlers
  // hand each chunk to this function instead of push()ing it (node parity: a
  // wrapped socket goes quiet). See internal/net/tlsFeeder.
  kTLSUpgradeSink: Symbol("kTLSUpgradeSink"),
};
