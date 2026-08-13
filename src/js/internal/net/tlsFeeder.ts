const { kTLSUpgradeSink } = require("internal/net/symbols");

// Wires upgradeDuplexToTLS's data callback to the transport. Same split as
// node's TLSSocket (lib/internal/tls/wrap.js L566-576): a handle-backed
// net.Socket is fed below the stream (kTLSUpgradeSink, draining what it had
// buffered like node's initRead); any other Duplex is fed from `data`.
function attachTLSFeeder(connection, feed) {
  const { Socket } = require("node:net");
  if (!(connection instanceof Socket) || !connection._handle) {
    connection.on("data", feed);
    return;
  }
  connection[kTLSUpgradeSink] = feed;
  let chunk;
  while ((chunk = connection.read()) !== null) feed(chunk);
}

function detachTLSFeeder(connection, feed) {
  if (connection[kTLSUpgradeSink] === feed) connection[kTLSUpgradeSink] = undefined;
  connection.removeListener("data", feed);
}

export default { attachTLSFeeder, detachTLSFeeder };
