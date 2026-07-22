// for net.Server, get ._handle

// const handleConversion = {
//   "net.Server": {
//     simultaneousAccepts: true,

//     send(message, server, options) {
//       return server._handle;
//     },

//     got(message, handle, emit) {
//       const server = new net.Server();
//       server.listen(handle, () => {
//         emit(server);
//       });
//     },
//   },

//   "net.Socket": {
//     send(message, socket, options) {
//       if (!socket._handle) return;

//       // If the socket was created by net.Server
//       if (socket.server) {
//         // The worker should keep track of the socket
//         message.key = socket.server._connectionKey;

//         const firstTime = !this[kChannelHandle].sockets.send[message.key];
//         const socketList = getSocketList("send", this, message.key);

//         // The server should no longer expose a .connection property
//         // and when asked to close it should query the socket status from
//         // the workers
//         if (firstTime) socket.server._setupWorker(socketList);

//         // Act like socket is detached
//         if (!options.keepOpen) socket.server._connections--;
//       }

//       const handle = socket._handle;

//       // Remove handle from socket object, it will be closed when the socket
//       // will be sent
//       if (!options.keepOpen) {
//         handle.onread = nop;
//         socket._handle = null;
//         socket.setTimeout(0);

//         if (freeParser === undefined) freeParser = require("_http_common").freeParser;
//         if (HTTPParser === undefined) HTTPParser = require("_http_common").HTTPParser;

//         // In case of an HTTP connection socket, release the associated
//         // resources
//         if (socket.parser && socket.parser instanceof HTTPParser) {
//           freeParser(socket.parser, null, socket);
//           if (socket._httpMessage) socket._httpMessage.detachSocket(socket);
//         }
//       }

//       return handle;
//     },

//     postSend(message, handle, options, callback, target) {
//       // Store the handle after successfully sending it, so it can be closed
//       // when the NODE_HANDLE_ACK is received. If the handle could not be sent,
//       // just close it.
//       if (handle && !options.keepOpen) {
//         if (target) {
//           // There can only be one _pendingMessage as passing handles are
//           // processed one at a time: handles are stored in _handleQueue while
//           // waiting for the NODE_HANDLE_ACK of the current passing handle.
//           assert(!target._pendingMessage);
//           target._pendingMessage = { callback, message, handle, options, retransmissions: 0 };
//         } else {
//           handle.close();
//         }
//       }
//     // NOTE that another function will call _pendingMessage.handle.close() and set _pendingMessage to null
//     },

//     got(message, handle, emit) {
//       const socket = new net.Socket({
//         handle: handle,
//         readable: true,
//         writable: true,
//       });

//       // If the socket was created by net.Server we will track the socket
//       if (message.key) {
//         // Add socket to connections list
//         const socketList = getSocketList("got", this, message.key);
//         socketList.add({
//           socket: socket,
//         });
//       }

//       emit(socket);
//     },
//   },

//   "dgram.Native": {
//     simultaneousAccepts: false,

//     send(message, handle, options) {
//       return handle;
//     },

//     got(message, handle, emit) {
//       emit(handle);
//     },
//   },

//   "dgram.Socket": {
//     simultaneousAccepts: false,

//     send(message, socket, options) {
//       message.dgramType = socket.type;

//       return socket[kStateSymbol].handle;
//     },

//     got(message, handle, emit) {
//       const socket = new dgram.Socket(message.dgramType);

//       socket.bind(handle, () => {
//         emit(socket);
//       });
//     },
//   },
// };

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
export function serialize(message, handle, options, target) {
  const net = require("node:net");
  if (handle instanceof net.Server) {
    const native = handle._handle;
    if (!native) return null;
    return [native, { cmd: "NODE_HANDLE", msg: message, type: "net.Server" }];
  }
  if (handle instanceof net.Socket) {
    // Bun.serve-backed node:http server connections keep their native socket
    // under kHandle instead of _handle.
    const native = handle._handle ?? handle[require("internal/http").kHandle];
    if (!native) return null;
    const serialized: any = { cmd: "NODE_HANDLE", msg: message, type: "net.Socket" };
    const keepOpen = !!options?.keepOpen;
    // null = the process object; undefined = no channel owner (raw
    // Subprocess.send), in which case the socket is sent untracked.
    const owner = target === null ? process : target;
    const server = handle.server;
    if (owner && server && server._connectionKey !== undefined) {
      // Like node's handleConversion: the server stops counting the sent
      // socket and polls the receiving process instead (socket_list).
      serialized.key = server._connectionKey;
      const { getSocketList, kChannelSockets } = require("internal/socket_list");
      const firstTime = !owner[kChannelSockets]?.send[serialized.key];
      const socketList = getSocketList("send", owner, serialized.key);
      if (firstTime) server._setupWorker(socketList);
      if (!keepOpen) {
        server._connections--;
        // The native layer closes the sender's descriptor after the handle
        // ACK; detach the server (both aliases — _destroy decrements via
        // _server) so that close does not decrement again.
        handle.server = null;
        handle._server = null;
      }
    }
    if (!keepOpen) {
      // Act like the socket is detached: stop its inactivity timer and
      // release HTTP parser resources, like node's handleConversion.
      handle.setTimeout(0);
      const parser = handle.parser;
      if (parser) {
        const { freeParser, HTTPParser } = require("node:_http_common");
        if (parser instanceof HTTPParser) {
          freeParser(parser, null, handle);
        } else if (typeof parser.free === "function") {
          // Bun.serve-backed server connections use a parser shim.
          parser.incoming = null;
          parser.socket = null;
          parser.free();
          handle.parser = null;
        }
        if (handle._httpMessage) handle._httpMessage.detachSocket(handle);
      }
    }
    return [native, serialized];
  }
  const dgram = require("node:dgram");
  if (handle instanceof dgram.Socket) {
    if (process.platform === "win32") {
      // Sending dgram sockets to child processes is not supported on Windows.
      throw $ERR_INVALID_HANDLE_TYPE();
    }
    const fd = handle[require("internal/dgram").kStateSymbol]?.handle?.fd;
    if (typeof fd !== "number" || fd < 0) {
      // An unbound dgram socket has no descriptor: fail the send like node's
      // uv write does (EBADF) rather than silently dropping the handle.
      const err: any = new Error("write EBADF");
      err.code = "EBADF";
      err.errno = -9;
      err.syscall = "write";
      throw err;
    }
    // The raw descriptor is the native payload: the sender keeps its socket
    // (node's dgram.Socket conversion has no postSend close).
    return [fd, { cmd: "NODE_HANDLE", msg: message, type: "dgram.Socket", dgramType: handle.type }];
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
      if (serialized.key) {
        // The sender's net.Server tracks this socket: register it so the
        // NODE_SOCKET_* count/notify-close queries see it (socket_list).
        const { getSocketList, getChannelOwner } = require("internal/socket_list");
        const owner = target === null ? process : getChannelOwner(target);
        if (owner) getSocketList("got", owner, serialized.key).add({ socket });
      }
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
      emit(target, serialized.msg, wrap);
      return;
    }
    case "dgram.Socket": {
      const dgram = require("node:dgram");
      const socket = dgram.createSocket(serialized.dgramType);
      // exclusive: the SCM_RIGHTS descriptor is local; without it a cluster
      // worker's bind({ fd }) would resolve fd in the primary's fd space.
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
