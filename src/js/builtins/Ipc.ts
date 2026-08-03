// have to use jsdoc type definitions because bundle-functions is based on regex
/**
 * @typedef {Object} Serialized
 * @property {"NODE_HANDLE"} cmd
 * @property {unknown} message
 * @property {"net.Socket" | "net.Server" | "dgram.Socket"} type
 */
/**
 * @typedef {import("node:net").Server | import("node:net").Socket | import("node:dgram").Socket} Handle
 */
/**
 * @param {unknown} message
 * @param {Handle} handle
 * @param {{ keepOpen?: boolean } | undefined} options
 * @returns {[unknown, Serialized] | null}
 */
export function serialize(_message, _handle, _options) {
  // sending file descriptors is not supported yet
  return null; // send the message without the file descriptor

  /*
  const net = require("node:net");
  const dgram = require("node:dgram");
  if (handle instanceof net.Server) {
    // this one doesn't need a close function, but the fd needs to be kept alive until it is sent
    const server = handle as unknown as (typeof net)["Server"] & { _handle: Bun.TCPSocketListener<unknown> };
    return [server._handle, { cmd: "NODE_HANDLE", message, type: "net.Server" }];
  } else if (handle instanceof net.Socket) {
    const new_message: { cmd: "NODE_HANDLE"; message: unknown; type: "net.Socket"; key?: string } = {
      cmd: "NODE_HANDLE",
      message,
      type: "net.Socket",
    };
    const socket = handle as unknown as (typeof net)["Socket"] & {
      _handle: Bun.Socket;
      server: (typeof net)["Server"] | null;
      setTimeout(timeout: number): void;
    };
    if (!socket._handle) return null; // failed

    // If the socket was created by net.Server
    if (socket.server) {
      // The worker should keep track of the socket
      new_message.key = socket.server._connectionKey;

      const firstTime = !this[kChannelHandle].sockets.send[message.key];
      const socketList = getSocketList("send", this, message.key);

      // The server should no longer expose a .connection property
      // and when asked to close it should query the socket status from
      // the workers
      if (firstTime) socket.server._setupWorker(socketList);

      // Act like socket is detached
      if (!options?.keepOpen) socket.server._connections--;
    }

    const internal_handle = socket._handle;

    // Remove handle from socket object, it will be closed when the socket
    // will be sent
    if (!options?.keepOpen) {
      // we can use a $newRustFunction to have it unset the callback
      internal_handle.onread = nop;
      socket._handle = null;
      socket.setTimeout(0);
    }
    return [internal_handle, new_message];
  } else if (handle instanceof dgram.Socket) {
    // this one doesn't need a close function, but the fd needs to be kept alive until it is sent
    throw new Error("todo serialize dgram.Socket");
  } else {
    throw $ERR_INVALID_HANDLE_TYPE();
  }
  */
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
      server.listen({ fd }, () => {
        emit(target, serialized.message, server);
      });
      return;
    }
    case "net.Socket": {
      throw new Error("TODO case net.Socket");
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
      throw new Error("TODO case dgram.Socket");
    }
    default: {
      throw new Error("failed to parse handle");
    }
  }
}
