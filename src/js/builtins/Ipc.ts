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
export function serialize(message, handle, _options) {
  const net = require("node:net");
  if (handle instanceof net.Server) {
    const native = handle._handle;
    if (!native) return null;
    return [native, { cmd: "NODE_HANDLE", msg: message, type: "net.Server" }];
  }
  if (handle instanceof net.Socket) {
    const native = handle._handle;
    if (!native) return null;
    return [native, { cmd: "NODE_HANDLE", msg: message, type: "net.Socket" }];
  }
  if (handle instanceof require("node:dgram").Socket) {
    return null;
  }
  throw $ERR_INVALID_HANDLE_TYPE();
}
/**
 * @param {Serialized} serialized
 * @param {unknown} handle
 * @param {(handle: Handle) => void} emit
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
        // The wrap only owns the descriptor on success; don't leak it.
        require("node:fs").closeSync(fd);
        throw new Error(`failed to open received dgram handle: ${err}`);
      }
      emit(target, serialized.message, wrap);
      return;
    }
    case "dgram.Socket": {
      throw new Error("dgram.Socket handles are not supported over IPC");
    }
    default: {
      throw new Error("failed to parse handle");
    }
  }
}
