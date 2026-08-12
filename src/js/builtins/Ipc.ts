// have to use jsdoc type definitions because bundle-functions is based on regex
/**
 * @typedef {Object} Serialized
 * @property {"NODE_HANDLE"} cmd
 * @property {"net.Socket" | "net.Server" | "dgram.Socket"} type
 */
/**
 * @typedef {import("node:net").Server | import("node:net").Socket | import("node:dgram").Socket} Handle
 */
/**
 * @param {unknown} message
 * @param {Handle} handle
 * @returns {[unknown, Serialized] | null}
 */
export function serialize(message, handle, options) {
  const net = require("node:net");
  if (handle instanceof net.Server) {
    const native = handle._handle;
    if (!native) return null;
    return [native, { cmd: "NODE_HANDLE", msg: message, type: "net.Server" }];
  }
  if (handle instanceof net.Socket) {
    // Only plain TCP sockets cross processes; a TLS session cannot (node: ERR_INVALID_HANDLE_TYPE).
    if (typeof handle[Symbol.for("::buntls::")] === "function") throw $ERR_INVALID_HANDLE_TYPE();
    const native = handle._handle;
    if (!native) return null;
    if (!options?.keepOpen) {
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L120-L148
      const { server } = handle;
      if (server) server._connections--;
      handle.setTimeout(0);
      native.data = undefined;
      handle._handle = null;
    }
    return [native, { cmd: "NODE_HANDLE", msg: message, type: "net.Socket" }];
  }
  if (handle instanceof require("node:dgram").Socket) {
    const { kStateSymbol } = require("internal/dgram");
    const native = handle[kStateSymbol]?.handle?.socket;
    if (!native) return null;
    return [native, { cmd: "NODE_HANDLE", msg: message, type: "dgram.Socket", dgramType: handle.type }];
  }
  throw $ERR_INVALID_HANDLE_TYPE();
}
/**
 * Adopts the descriptor that arrived with a NODE_HANDLE message into the handle type the sender
 * named. Owns `fd`: when nothing adopted it, it is closed here; when this throws, ipc.rs closes it.
 *
 * @param {unknown} target
 * @param {Serialized} serialized
 * @param {number} fd
 * @returns {void}
 */
export function parseHandle(target, serialized, fd) {
  const emit = $newRustFunction("ipc.rs", "emitHandleIPCMessage", 3);
  const net = require("node:net");
  // const dgram = require("node:dgram");
  switch (serialized.type) {
    case "net.Server": {
      const server = new net.Server();
      server.listen({ fd, exclusive: true }, () => {
        emit(target, serialized.msg, server);
      });
      if (!server._handle) {
        // listen({ fd }) adopts synchronously; when it refused the descriptor (the error is emitted
        // on a later tick) the descriptor is still open and nothing refers to it anymore.
        const closeRawHandle = $newRustFunction("node_cluster_binding.rs", "clusterCloseHandle", 1);
        closeRawHandle(fd);
      }
      return;
    }
    case "net.Socket": {
      const socket = new net.Socket({ readable: true, writable: true });
      socket.connect({ fd, fdIsRawSocket: true });
      emit(target, serialized.msg, socket);
      return;
    }
    case "dgram.Native": {
      // A non-reading UDP handle (cluster-shared dgram socket): wrap the
      // received descriptor so the cluster child can adopt it.
      const { UDP } = require("internal/dgram");
      const wrap = new UDP();
      const err = wrap.open(fd);
      if (err) {
        // The wrap only owns the descriptor on success; throwing hands it back to ipc.rs, which closes it.
        throw new Error(`failed to open received dgram handle: ${err}`);
      }
      emit(target, serialized.msg, wrap);
      return;
    }
    case "dgram.Socket": {
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js handleConversion['dgram.Socket'].got
      const dgram = require("node:dgram");
      const socket = new dgram.Socket(serialized.dgramType || "udp4");
      socket.bind({ fd, exclusive: true }, () => {
        emit(target, serialized.msg, socket);
      });
      return;
    }
    default: {
      throw new Error("failed to parse handle");
    }
  }
}

/**
 * Advanced-mode IPC Buffer tagging; the mechanism lives in
 * internal/serialization_buffers (shared with node:v8 serialize/deserialize).
 * Returns null when the message holds no Buffers so the caller keeps the bare
 * wire format (and its zero-walk ack fast paths).
 *
 * @param {unknown} message
 * @returns {[unknown, unknown[]] | null}
 */
export function tagAdvancedBuffers(message) {
  return require("internal/serialization_buffers").tagBuffers(message);
}

/**
 * Receive side of tagAdvancedBuffers.
 *
 * @param {unknown} envelope
 * @returns {unknown}
 */
export function restoreAdvancedBuffers(envelope) {
  return require("internal/serialization_buffers").restoreBuffers(envelope);
}
