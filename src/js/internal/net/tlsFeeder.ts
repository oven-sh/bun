const { kTLSUpgradeSink } = require("internal/net/symbols");

// Wires upgradeDuplexToTLS's data callback to the transport. Same split as
// node's TLSSocket (lib/internal/tls/wrap.js L566-576): a handle-backed
// net.Socket is fed below the stream (kTLSUpgradeSink); any other Duplex is fed
// from `data`.
function attachTLSFeeder(connection, feed) {
  const { Socket } = require("node:net");
  if (!(connection instanceof Socket) || !connection._handle) {
    connection.on("data", feed);
    return;
  }
  connection[kTLSUpgradeSink] = feed;
  // Nothing else can reach `feed` before this tick runs, and by then the caller
  // has finished wiring the engine up, so what these bytes provoke (an error,
  // if setEncoding turned them into strings) lands on the TLS socket. Same
  // timing as node's initRead.
  process.nextTick(feedBuffered, connection, feed);
}

function feedBuffered(connection, feed) {
  if (connection[kTLSUpgradeSink] !== feed) return;
  let chunk;
  while ((chunk = connection.read()) !== null) feed(chunk);
}

function detachTLSFeeder(connection, feed) {
  if (connection[kTLSUpgradeSink] === feed) connection[kTLSUpgradeSink] = undefined;
  connection.removeListener("data", feed);
}

export default { attachTLSFeeder, detachTLSFeeder };
