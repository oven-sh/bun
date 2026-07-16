// Serialization of the handle attached to an IPC message sent with
// `subprocess.send(message, handle)` / `process.send(message, handle)`.
// Mirrors the `handleConversion` table in Node's lib/internal/child_process.js:
// https://github.com/nodejs/node/blob/main/lib/internal/child_process.js
//
// The transport (SCM_RIGHTS over the IPC socketpair, the NODE_HANDLE /
// NODE_HANDLE_ACK / NODE_HANDLE_NACK handshake, the ack-gated send queue)
// lives in src/jsc/ipc.rs; `do_send` in src/runtime/ipc_host.rs takes the
// native handle returned from `serialize()` and dups its fd into the queued
// message, so the sender's copy can be released independently.

// have to use jsdoc type definitions because bundle-functions is based on regex
/**
 * @typedef {Object} Serialized
 * @property {"NODE_HANDLE"} cmd
 * @property {"net.Server" | "net.Socket"} type
 * @property {unknown} msg
 */

/**
 * Map a user-provided handle to `[nativeHandle, wrappedMessage]`. Returns
 * `null` to send `message` with no handle (its socket is already gone — Node
 * falls back the same way); throws for handle types that cannot be sent.
 *
 * @param {unknown} message
 * @param {import("node:net").Server | import("node:net").Socket} handle
 * @param {{ keepOpen?: boolean } | undefined} options
 * @returns {[unknown, Serialized] | null}
 */
export function serialize(message, handle, options) {
  const net = require("node:net");
  const isSocket = handle instanceof net.Socket;
  if (!isSocket && !(handle instanceof net.Server)) {
    // dgram.Socket needs an fd getter on Bun's native UDPSocket plus a
    // bind-to-fd path, neither of which exist yet. Everything else is not a
    // sendable handle in Node either. Never silently drop the handle.
    throw $ERR_INVALID_HANDLE_TYPE();
  }
  if (process.platform === "win32") {
    // Bun's Windows IPC channel is a libuv named pipe with no SOCKET
    // duplication (uv_write2 / WSADuplicateSocketW) yet, so fall back to sending
    // the message with no handle (receiver sees handle === undefined) rather
    // than throwing synchronously out of send() — matching the pre-feature
    // behavior that cross-platform code and the Node IPC tests rely on.
    return null;
  }

  const nativeHandle = handle._handle;
  if (!nativeHandle) return null;

  if (isSocket) {
    // `tls.TLSSocket extends net.Socket`, so TLS sockets land here too
    // (matching Node); the receiver reconstructs a plain net.Socket around
    // the transferred fd — TLS session state is not transferable.
    if (!options?.keepOpen) {
      // For a server-accepted socket, decrement the server's connection count
      // now (Node does this synchronously on handoff) and null `.server` so the
      // deferred `_destroy` doesn't double-count — otherwise with allowHalfOpen
      // the server never drains and `server.close()` never emits 'close'.
      if (handle.server) {
        handle.server._connections--;
        handle.server = null;
      }
      // Node detaches the sender's socket the moment it is sent. Closing the
      // native handle is deferred one tick — past `do_send`'s dup — so the
      // sender's event loop stops consuming bytes that now belong to the
      // receiving process and its copy of the fd is released.
      handle._handle = null;
      handle.setTimeout(0);
      process.nextTick(h => h.close(), nativeHandle);
    }
    return [nativeHandle, { cmd: "NODE_HANDLE", type: "net.Socket", msg: message }];
  }

  // net.Server: the listener stays open in the sender. Both processes
  // accept() on the shared fd (the pre-fork server model).
  return [nativeHandle, { cmd: "NODE_HANDLE", type: "net.Server", msg: message }];
}

/**
 * Reconstruct a handle object around a file descriptor received over
 * SCM_RIGHTS and re-dispatch the wrapped user message with it. Invoked from
 * `handle_ipc_message` (src/jsc/ipc.rs) once a `NODE_HANDLE` message and its
 * ancillary fd have both arrived (the ACK has already been written back).
 * On success the constructed handle owns `fd`.
 *
 * @param {unknown} target the Subprocess (parent side) or null (child side)
 * @param {Serialized} serialized
 * @param {number} fd
 */
export function parseHandle(target, serialized, fd) {
  const emit = $newRustFunction("ipc.rs", "emitHandleIPCMessage", 3);
  const net = require("node:net");
  switch (serialized.type) {
    case "net.Server": {
      const server = new net.Server();
      // exclusive: true adopts the fd directly (a cluster worker would otherwise
      // route it to the primary as a queryServer). Bun.listen({ fd }) is
      // synchronous, so emit now, not from the setTimeout-deferred listen cb.
      server.listen({ fd, exclusive: true });
      emit(target, serialized.msg, server);
      return;
    }
    case "net.Socket": {
      // Adopt the already-connected fd. `connect({ fd })` opens synchronously
      // (the native `open` handler fires inside it), so the socket handed to
      // the 'message' listener is already live.
      const socket = new net.Socket();
      socket.connect({ fd });
      emit(target, serialized.msg, socket);
      return;
    }
    default: {
      // A handle type Bun cannot reconstruct (e.g. a dgram.Socket or a raw
      // net.Native/dgram.Native wrap from a Node.js peer). The sender was
      // already ACK'd, so the fd is ours to release; leaking it would also
      // pin the peer's connection open.
      require("node:fs").closeSync(fd);
      throw new Error(
        `Cannot receive a ${JSON.stringify(serialized.type)} handle over IPC; only "net.Server" and "net.Socket" are supported`,
      );
    }
  }
}
