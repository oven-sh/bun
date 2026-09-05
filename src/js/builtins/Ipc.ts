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
    // Only plain TCP sockets cross processes; a TLS session cannot (node: ERR_INVALID_HANDLE_TYPE).
    if (typeof handle[Symbol.for("::buntls::")] === "function") throw $ERR_INVALID_HANDLE_TYPE();
    const jsHandle = handle._handle;
    const native = jsHandle ?? handle[require("internal/http").kHandle];
    if (!native) return null;
    const serialized: any = { cmd: "NODE_HANDLE", msg: message, type: "net.Socket" };
    const keepOpen = !!options?.keepOpen;
    const owner = target === null ? process : target;
    const server = handle.server;
    const connectionKey = server ? server._connectionKey : undefined;
    if (owner && connectionKey !== undefined) {
      serialized.key = connectionKey;
      const { getSocketList, kChannelSockets } = require("internal/socket_list");
      const firstTime = !owner[kChannelSockets]?.send[serialized.key];
      const socketList = getSocketList("send", owner, serialized.key);
      if (firstTime) server._setupWorker(socketList);
    }
    if (!keepOpen) {
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L120-L148
      // Only a server that counts its connections in JS (net.Server; Bun's http.Server
      // counts natively) hands the count over and drops the socket's back-reference,
      // which its _destroy would otherwise decrement again.
      if (server && typeof server._connections === "number") {
        server._connections--;
        handle.server = null;
        handle._server = null;
      }
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L120-L148
      handle.setTimeout(0);
      const parser = handle.parser;
      if (parser) {
        const { freeParser, HTTPParser } = require("node:_http_common");
        if (parser instanceof HTTPParser) {
          freeParser(parser, null, handle);
        } else if (typeof parser.free === "function") {
          parser.incoming = null;
          parser.socket = null;
          parser.free();
          handle.parser = null;
        }
        const { _httpMessage } = handle;
        if (_httpMessage) _httpMessage.detachSocket(handle);
      }
      if (jsHandle) {
        jsHandle.data = undefined;
        handle._handle = null;
      }
    }
    return [native, serialized];
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
      const { key: serializedKey } = serialized;
      if (serializedKey) {
        const { getSocketList, getChannelOwner } = require("internal/socket_list");
        const owner = target === null ? process : getChannelOwner(target);
        if (owner) getSocketList("got", owner, serializedKey).add({ socket });
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
        try {
          require("node:fs").closeSync(fd);
        } catch {}
        throw new Error(`failed to open received dgram handle: ${err}`);
      }
      emit(target, serialized.msg, wrap);
      return;
    }
    case "dgram.Socket": {
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js handleConversion['dgram.Socket'].got
      const dgram = require("node:dgram");
      const socket = new dgram.Socket(serialized.dgramType || "udp4");
      function throwOnAdoptionFailure(err) {
        try {
          require("node:fs").closeSync(fd);
        } catch {}
        throw new Error(`failed to adopt received dgram handle: ${err.code || err.message}`, { cause: err });
      }
      socket.once("error", throwOnAdoptionFailure);
      try {
        // bind({ fd }) throws at once for a descriptor that is not a UDP socket
        // or is already adopted, before any 'error' event.
        socket.bind({ fd, exclusive: true }, () => {
          socket.removeListener("error", throwOnAdoptionFailure);
          emit(target, serialized.msg, socket);
        });
      } catch (err) {
        socket.removeListener("error", throwOnAdoptionFailure);
        throwOnAdoptionFailure(err);
      }
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
