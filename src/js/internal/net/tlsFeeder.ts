const { kTLSUpgradeSink } = require("internal/net/symbols");

// `feed` is events[0] of upgradeDuplexToTLS: it hands the connection's bytes to
// the stream-level TLS engine. Same split as node's TLSSocket constructor
// (https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L566-L576):
// a net.Socket with a handle is taken over below the stream, so it is fed from
// its raw data handlers (kTLSUpgradeSink) and nothing reaches its own readable
// side any more; whatever it had buffered before the upgrade is handed over
// here, as node's initRead does. Any other Duplex is fed from its public `data`
// event, like node's JSStreamSocket.
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
