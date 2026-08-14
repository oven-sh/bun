const { kTLSUpgradeSink } = require("internal/net/symbols");

// Same split as node's TLSSocket (lib/internal/tls/wrap.js L566-576): a
// handle-backed net.Socket is fed below the stream, any other Duplex from `data`.
function attachTLSFeeder(connection, feed) {
  const { Socket } = require("node:net");
  if (!(connection instanceof Socket) || !connection._handle) {
    connection.on("data", feed);
    return;
  }
  connection[kTLSUpgradeSink] = feed;
  // Next tick, like node's initRead: the TLS socket is not wired up yet, so an
  // error these bytes provoke (strings, after setEncoding) would be lost now.
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
