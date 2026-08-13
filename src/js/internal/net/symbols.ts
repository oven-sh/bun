export default {
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),
  // Internal handshake-settled signal: server-side sockets emit no user
  // 'secureConnect' (node parity), so internal deferrals park on this instead.
  kSecureConnectDone: Symbol("kSecureConnectDone"),
  kVerifyError: Symbol("kVerifyError"),
  // Set on a net.Socket once a TLS engine has been layered over it
  // (tls.connect({ socket }), new TLSSocket(socket), Http2SecureServer
  // 'connection'). Its handle keeps delivering bytes, but they are now that
  // engine's ciphertext: the raw data handlers in node:net pass them to this
  // function instead of push()ing them, so the socket goes quiet the way node's
  // does once it is wrapped. fd adoption (upgradeTLS) decrypts natively and only
  // mirrors the bytes here, so it installs a no-op; the stream-level engine
  // (upgradeDuplexToTLS) installs its feeder, see internal/net/tlsFeeder.
  kTLSUpgradeSink: Symbol("kTLSUpgradeSink"),
};
