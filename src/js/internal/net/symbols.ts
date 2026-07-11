// Symbols shared between the node:net and node:tls builtins.
//
// These are real exported symbols rather than Symbol.for() keys: the global
// registry is reachable from user code, so a Symbol.for() slot is effectively
// public API that anyone can read or overwrite on a socket.

export default {
  // node:net installs Server.prototype[kArmHandshakeTimeout]; node:tls calls it
  // when a socket handed in via server.emit("connection") is wrapped, so a
  // STARTTLS wrap arms the same handshake timeout as a native accept.
  kArmHandshakeTimeout: Symbol("kArmHandshakeTimeout"),

  // Set by node:net's handshake handlers, read by node:tls to back
  // `tlsSocket.ssl.verifyError()`.
  kVerifyError: Symbol("kVerifyError"),
};
