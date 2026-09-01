// The stream-level TLS engine (upgradeDuplexToTLS) over an existing stream. A
// net.Socket with a native handle is read and written below JS (node's TLSWrap
// over the parent's handle) and hands over what it had already buffered; any
// other Duplex is driven from its events (node's JSStreamSocket):
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L566-L579.
const upgradeDuplexToTLS = $newRustFunction("runtime/socket/socket.rs", "jsUpgradeDuplexToTLS", 2);

function upgradeStreamToTLS(owner: { destroyed: boolean }, connection, options) {
  const { Socket } = require("node:net");
  if (connection instanceof Socket) {
    options.transport = connection._handle;
    options.deferHandshake = hasUnflushedWrites(connection);
  }
  const [handle, events, nativeTransport] = upgradeDuplexToTLS(connection, options);
  if (nativeTransport) {
    // Already-buffered bytes go to feedBuffered, not flow(); an EOF already
    // taken off the wire is stream state (a later one arrives natively).
    connection.pause();
    const ended = connection._readableState?.ended;
    process.nextTick(feedBuffered, owner, connection, events[0], ended ? events[1] : undefined);
    if (options.deferHandshake) startTLSHandshakeWhenFlushed(owner, connection, handle);
  } else {
    connection.on("data", events[0]);
    connection.on("end", events[1]);
    connection.on("drain", events[2]);
    connection.on("close", events[3]);
  }
  return [handle, events];
}

function feedBuffered(owner, connection, feed, end) {
  if (owner.destroyed || connection.destroyed) return;
  let chunk;
  while ((chunk = connection.read()) !== null) feed(chunk);
  end?.();
}

// Plaintext still queued on `connection` must reach the wire before any TLS
// record (node's wrapHasActiveWriteFromPrevOwner): the native side holds our
// output until the empty write queued behind it completes.
function hasUnflushedWrites(connection): boolean {
  return connection.writableLength > 0;
}

function startTLSHandshakeWhenFlushed(owner, connection, handle) {
  connection.write("", err => {
    if (!err && !owner.destroyed && !connection.destroyed) handle.startTLSHandshake();
  });
}

export default { upgradeStreamToTLS, hasUnflushedWrites, startTLSHandshakeWhenFlushed };
