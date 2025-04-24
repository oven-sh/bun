// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

const BIND_STATE_UNBOUND = 0;
const BIND_STATE_BINDING = 1;
const BIND_STATE_BOUND = 2;

const CONNECT_STATE_DISCONNECTED = 0;
const CONNECT_STATE_CONNECTING = 1;
const CONNECT_STATE_CONNECTED = 2;

const RECV_BUFFER = true;
const SEND_BUFFER = false;

const enum uSockets {
  LISTEN_DEFAULT = 0,
  LISTEN_EXCLUSIVE_PORT = 1,
  SOCKET_ALLOW_HALF_OPEN = 2,
  LISTEN_REUSE_PORT = 4,
  SOCKET_IPV6_ONLY = 8,
  LISTEN_REUSE_ADDR = 16,
  LISTEN_DISALLOW_REUSE_PORT_FAILURE = 32,
}

const kStateSymbol: unique symbol = Symbol("state symbol");
const kOwnerSymbol = Symbol("owner symbol");
const async_id_symbol = Symbol("async_id_symbol");

const { throwNotImplemented } = require("internal/shared");
const {
  validateString,
  validateNumber,
  validateFunction,
  validatePort,
  validateAbortSignal,
} = require("internal/validators");

const { isIP } = require("./net");

import EventEmitter from "node:events";

const { deprecate } = require("node:util");

const SymbolDispose = Symbol.dispose;
const SymbolAsyncDispose = Symbol.asyncDispose;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectDefineProperty = Object.defineProperty;
const FunctionPrototypeBind = Function.prototype.bind;

class ERR_SOCKET_BUFFER_SIZE extends Error {
  code = "ERR_SOCKET_BUFFER_SIZE";
  constructor(ctx) {
    super(`Invalid buffer size: ${ctx}`);
  }
}

function isInt32(value) {
  return value === (value | 0);
}

// placeholder
function defaultTriggerAsyncIdScope(triggerAsyncId, block, ...args) {
  return block.$apply(null, args);
}

function lookup4(lookup, address, callback) {
  return lookup(address || "127.0.0.1", 4, callback);
}

function lookup6(lookup, address, callback) {
  return lookup(address || "::1", 6, callback);
}

function EINVAL(syscall) {
  throw Object.assign(new Error(`${syscall} EINVAL`), {
    code: "EINVAL",
    syscall,
  });
}

let dns;

interface SocketState {
  handle: DgramHandle | null; // Can be null after close
  receiving: boolean;
  bindState: number;
  connectState: number;
  queue: Function[] | undefined;
  reuseAddr: boolean | undefined;
  reusePort: boolean | undefined;
  ipv6Only: boolean | undefined;
  recvBufferSize: number | undefined;
  sendBufferSize: number | undefined;
  unrefOnBind: boolean;
}

interface SocketOptions {
  type: "udp4" | "udp6";
  lookup?: (
    hostname: string,
    options: any,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
  ) => void;
  recvBufferSize?: number;
  sendBufferSize?: number;
  reuseAddr?: boolean;
  reusePort?: boolean;
  ipv6Only?: boolean;
  signal?: AbortSignal;
}

interface DgramHandle {
  lookup: (address: string, callback: (err: Error | null, ip: string) => void) => void;
  onmessage: (nread: number, handle: DgramHandle, buf: Buffer, rinfo: RemoteInfo) => void;
  [kOwnerSymbol]?: Socket; // Use the class here
  socket?: $ZigGeneratedClasses.UDPSocket;
  getAsyncId?(): number;
}

interface RemoteInfo {
  address: string;
  family: "IPv4" | "IPv6";
  port: number;
  size: number;
}

function newHandle(type, lookup): DgramHandle {
  if (lookup === undefined) {
    if (dns === undefined) {
      dns = require("node:dns");
    }

    lookup = dns.lookup;
  } else {
    validateFunction(lookup, "lookup");
  }

  const handle: Partial<DgramHandle> = {};
  if (type === "udp4") {
    handle.lookup = FunctionPrototypeBind.$call(lookup4, handle, lookup);
  } else if (type === "udp6") {
    handle.lookup = FunctionPrototypeBind.$call(lookup6, handle, lookup);
  } else {
    throw $ERR_SOCKET_BAD_TYPE();
  }

  handle.onmessage = onMessage;

  return handle as DgramHandle;
}

function onMessage(nread, handle, buf, rinfo) {
  const self = handle[kOwnerSymbol]; // self is now typed as Socket | undefined
  if (!self) return;
  if (nread < 0) {
    return self.emit(
      "error",
      Object.assign(new Error("recvmsg"), {
        syscall: "recvmsg",
        errno: nread,
      }),
    );
  }
  rinfo.size = buf.length; // compatibility
  self.emit("message", buf, rinfo);
}

let udpSocketChannel;

class Socket extends EventEmitter {
  [kStateSymbol]: SocketState;
  type: "udp4" | "udp6";
  [async_id_symbol]: number;

  constructor(typeOrOptions: "udp4" | "udp6" | SocketOptions, listener?: (msg: Buffer, rinfo: RemoteInfo) => void) {
    super(); // Call EventEmitter constructor

    let lookup;
    let recvBufferSize;
    let sendBufferSize;
    let options: SocketOptions | undefined;
    let type: "udp4" | "udp6";

    if (typeOrOptions !== null && typeof typeOrOptions === "object") {
      options = typeOrOptions;
      type = options.type;
      lookup = options.lookup;
      recvBufferSize = options.recvBufferSize;
      sendBufferSize = options.sendBufferSize;
    } else {
      type = typeOrOptions; // typeOrOptions must be 'udp4' | 'udp6' here
    }

    const handle = newHandle(type, lookup);
    handle[kOwnerSymbol] = this;

    this[async_id_symbol] = handle.getAsyncId?.() ?? -1;
    this.type = type;

    if (typeof listener === "function") this.on("message", listener);

    this[kStateSymbol] = {
      handle,
      receiving: false,
      bindState: BIND_STATE_UNBOUND,
      connectState: CONNECT_STATE_DISCONNECTED,
      queue: undefined,
      reuseAddr: options?.reuseAddr,
      reusePort: options?.reusePort,
      ipv6Only: options?.ipv6Only,
      recvBufferSize,
      sendBufferSize,
      unrefOnBind: false,
    };

    if (options?.signal !== undefined) {
      const { signal } = options;
      validateAbortSignal(signal, "options.signal");
      const onAborted = () => {
        if (this[kStateSymbol].handle) this.close();
      };
      if (signal.aborted) {
        onAborted();
      } else {
        const disposable = EventEmitter.addAbortListener(signal, onAborted);
        this.once("close", disposable[SymbolDispose]);
      }
    }
    if (!udpSocketChannel) {
      udpSocketChannel = require("node:diagnostics_channel").channel("udp.socket");
    }
    if (udpSocketChannel.hasSubscribers) {
      udpSocketChannel.publish({
        socket: this,
      });
    }
  }

  // Define methods directly in the class
  bind(port_?: number | object, address_?: string | Function, callback?: Function): this {
    let port = port_;

    const state = this[kStateSymbol];

    if (state.bindState !== BIND_STATE_UNBOUND) {
      this.emit("error", $ERR_SOCKET_ALREADY_BOUND());
      return this;
    }

    state.bindState = BIND_STATE_BINDING;

    const cb = arguments.length && arguments[arguments.length - 1];
    if (typeof cb === "function") {
      function removeListeners(this: Socket) {
        this.removeListener("error", removeListeners);
        this.removeListener("listening", onListening);
      }

      function onListening(this: Socket) {
        removeListeners.$call(this);
        cb.$call(this);
      }

      this.on("error", removeListeners);
      this.on("listening", onListening);
    }

    if (port !== null && typeof port === "object" && typeof (port as any).recvStart === "function") {
      throwNotImplemented("Socket.prototype.bind(handle)");
      /*
      replaceHandle(this, port);
      startListening(this);
      return this;
      */
    }

    // Open an existing fd instead of creating a new one.
    if (port !== null && typeof port === "object" && isInt32((port as any).fd) && (port as any).fd > 0) {
      throwNotImplemented("Socket.prototype.bind({ fd })");
      /*
      const fd = port.fd;
      const exclusive = !!port.exclusive;
      const state = this[kStateSymbol];

      const type = guessHandleType(fd);
      if (type !== 'UDP')
        throw new ERR_INVALID_FD_TYPE(type);
      const err = state.handle.open(fd);

      if (err)
        throw new ErrnoException(err, 'open');

      startListening(this);
      return this;
      */
    }

    let address;
    let bindOptions: { address?: string; port?: number; exclusive?: boolean } = {};

    if (port !== null && typeof port === "object") {
      bindOptions = port as any;
      address = bindOptions.address || "";
      port = bindOptions.port;
    } else {
      address = typeof address_ === "function" ? "" : address_;
    }

    // Defaulting address for bind to all interfaces
    if (!address) {
      if (this.type === "udp4") address = "0.0.0.0";
      else address = "::";
    }

    // Resolve address first
    state.handle!.lookup(address, (err, ip) => {
      if (!state.handle) return; // Handle has been closed in the mean time

      if (err) {
        state.bindState = BIND_STATE_UNBOUND;
        this.emit("error", err);
        return;
      }

      let flags = uSockets.LISTEN_DISALLOW_REUSE_PORT_FAILURE;

      if (state.reuseAddr) {
        flags |= uSockets.LISTEN_REUSE_ADDR;
      }

      if (state.ipv6Only) {
        flags |= uSockets.SOCKET_IPV6_ONLY;
      }

      if (state.reusePort) {
        flags |= uSockets.LISTEN_REUSE_PORT;
      }

      const family = this.type === "udp4" ? "IPv4" : "IPv6";
      try {
        Bun.udpSocket({
          hostname: ip,
          port: port || 0,
          flags,
          socket: {
            data: (_socket, data, port, address) => {
              this.emit("message", data, {
                port: port,
                address: address,
                size: data.length,
                family,
              });
            },
            error: error => {
              this.emit("error", error);
            },
          },
        } as any).$then(
          socket => {
            const zigSocket = socket as $ZigGeneratedClasses.UDPSocket;
            if (!state.handle) {
              // Handle was closed while the promise was pending
              zigSocket.close();
              return;
            }
            if (state.unrefOnBind) {
              zigSocket.unref();
              state.unrefOnBind = false;
            }
            state.handle.socket = zigSocket;
            state.receiving = true;
            state.bindState = BIND_STATE_BOUND;

            this.emit("listening");
          },
          err => {
            state.bindState = BIND_STATE_UNBOUND;
            this.emit("error", err);
          },
        );
      } catch (err) {
        state.bindState = BIND_STATE_UNBOUND;
        this.emit("error", err);
      }
    });

    return this;
  }

  connect(port: number, address?: string | Function, callback?: Function): void {
    port = validatePort(port, "Port", false);
    if (typeof address === "function") {
      callback = address;
      address = "";
    } else if (address === undefined) {
      address = "";
    }

    validateString(address, "address");

    const state = this[kStateSymbol];

    if (state.connectState !== CONNECT_STATE_DISCONNECTED) throw $ERR_SOCKET_DGRAM_IS_CONNECTED();

    state.connectState = CONNECT_STATE_CONNECTING;
    if (state.bindState === BIND_STATE_UNBOUND) this.bind({ port: 0, exclusive: true }, undefined);

    if (state.bindState !== BIND_STATE_BOUND) {
      enqueue(this, FunctionPrototypeBind.$call(_connect, this, port, address, callback));
      return;
    }

    _connect.$apply(this, [port, address, callback]);
  }

  send(
    buffer: Buffer | string | (Buffer | string)[],
    offset?: number | Function,
    length?: number | string | Function,
    port?: number | Function,
    address?: string | Function,
    callback?: Function,
  ): void {
    let list;
    const state = this[kStateSymbol];
    const connected = state.connectState === CONNECT_STATE_CONNECTED;
    if (!connected) {
      if (address || (port && typeof port !== "function")) {
        buffer = sliceBuffer(buffer, offset as number, length as number);
      } else {
        callback = port as Function;
        port = offset as number;
        address = length as string;
      }
    } else {
      if (typeof length === "number") {
        buffer = sliceBuffer(buffer, offset as number, length);
        if (typeof port === "function") {
          callback = port;
          port = undefined; // Fix: Use undefined instead of null
        }
      } else {
        callback = offset as Function;
      }

      if (port || address) throw $ERR_SOCKET_DGRAM_IS_CONNECTED();
    }

    if (!Array.isArray(buffer)) {
      if (typeof buffer === "string") {
        list = [Buffer.from(buffer)];
      } else if (!ArrayBuffer.isView(buffer)) {
        throw $ERR_INVALID_ARG_TYPE("buffer", ["string", "Buffer", "TypedArray", "DataView"], buffer);
      } else {
        list = [buffer];
      }
    } else if (!(list = fixBufferList(buffer))) {
      throw $ERR_INVALID_ARG_TYPE("buffer list arguments", ["string", "Buffer", "TypedArray", "DataView"], buffer);
    }

    if (!connected) port = validatePort(port as number, "Port", false);

    // Normalize callback so it's either a function or undefined but not anything
    // else.
    if (typeof callback !== "function") callback = undefined;

    if (typeof address === "function") {
      callback = address;
      address = undefined;
    } else if (address != null) {
      validateString(address, "address");
    }

    if (state.bindState === BIND_STATE_UNBOUND) this.bind({ port: 0, exclusive: true }, undefined);

    if (list.length === 0) list.push(Buffer.alloc(0));

    // If the socket hasn't been bound yet, push the outbound packet onto the
    // send queue and send after binding is complete.
    if (state.bindState !== BIND_STATE_BOUND) {
      enqueue(this, FunctionPrototypeBind.$call(this.send, this, list, port, address, callback));
      return;
    }

    const afterDns = (ex, ip) => {
      defaultTriggerAsyncIdScope(this[async_id_symbol], doSend, ex, this, ip, list, address, port, callback);
    };

    if (!connected) {
      state.handle!.lookup(address as string, afterDns);
    } else {
      afterDns(null, null);
    }
  }

  sendto(
    buffer: Buffer | string | (Buffer | string)[],
    offset: number,
    length: number,
    port: number,
    address: string,
    callback?: Function,
  ): void {
    validateNumber(offset, "offset");
    validateNumber(length, "length");
    validateNumber(port, "port");
    validateString(address, "address");

    this.send(buffer, offset, length, port, address, callback);
  }

  close(callback?: () => void): this {
    const state = this[kStateSymbol];
    const queue = state.queue;

    if (typeof callback === "function") this.on("close", callback);

    if (queue !== undefined) {
      queue.push(FunctionPrototypeBind.$call(this.close, this));
      return this;
    }

    if (!state.handle) {
      // Already closed or never opened
      if (callback) {
        process.nextTick(callback);
      }
      return this;
    }

    state.receiving = false;
    state.handle.socket?.close();
    state.handle = null as any; // Mark as closed
    defaultTriggerAsyncIdScope(this[async_id_symbol], process.nextTick, socketCloseNT, this);

    return this;
  }

  address(): { address: string; family: string; port: number } {
    const addr = this[kStateSymbol].handle?.socket?.address;
    if (!addr) throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
    return addr as { address: string; family: string; port: number }; // Fix: Cast to expected type
  }

  remoteAddress(): { address: string; family: string; port: number } {
    const state = this[kStateSymbol];
    const socket = state.handle?.socket;

    if (!socket) throw $ERR_SOCKET_DGRAM_NOT_RUNNING();

    if (state.connectState !== CONNECT_STATE_CONNECTED) throw $ERR_SOCKET_DGRAM_NOT_CONNECTED();

    if (!socket.remoteAddress) throw $ERR_SOCKET_DGRAM_NOT_CONNECTED();

    return socket.remoteAddress as { address: string; family: string; port: number }; // Fix: Cast to expected type
  }

  setBroadcast(flag: boolean): void {
    const handle = this[kStateSymbol].handle;
    if (!handle?.socket) {
      throw new Error("setBroadcast EBADF");
    }
    handle.socket.setBroadcast(flag);
  }

  setTTL(ttl: number): void {
    if (typeof ttl !== "number") {
      throw $ERR_INVALID_ARG_TYPE("ttl", "number", ttl);
    }

    const handle = this[kStateSymbol].handle;
    if (!handle?.socket) {
      throw new Error("setTTL EBADF");
    }
    handle.socket.setTTL(ttl);
  }

  setMulticastTTL(ttl: number): void {
    if (typeof ttl !== "number") {
      throw $ERR_INVALID_ARG_TYPE("ttl", "number", ttl);
    }

    const handle = this[kStateSymbol].handle;
    if (!handle?.socket) {
      throw new Error("setMulticastTTL EBADF");
    }
    handle.socket.setMulticastTTL(ttl);
  }

  setMulticastLoopback(flag: boolean): void {
    const handle = this[kStateSymbol].handle;
    if (!handle?.socket) {
      throw new Error("setMulticastLoopback EBADF");
    }
    handle.socket.setMulticastLoopback(flag);
  }

  setMulticastInterface(interfaceAddress: string): void {
    validateString(interfaceAddress, "interfaceAddress");
    const handle = this[kStateSymbol].handle;
    if (!handle?.socket) {
      throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
    }
    if (!handle.socket.setMulticastInterface(interfaceAddress)) {
      throw EINVAL("setMulticastInterface");
    }
  }

  addMembership(multicastAddress: string, interfaceAddress?: string): void {
    if (!multicastAddress) {
      throw $ERR_MISSING_ARGS("multicastAddress");
    }
    validateString(multicastAddress, "multicastAddress");
    if (typeof interfaceAddress !== "undefined") {
      validateString(interfaceAddress, "interfaceAddress");
    }
    const { handle, bindState } = this[kStateSymbol];
    if (!handle?.socket) {
      if (!isIP(multicastAddress)) {
        throw EINVAL("addMembership");
      }
      throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
    }
    if (bindState === BIND_STATE_UNBOUND) {
      this.bind({ port: 0, exclusive: true }, undefined);
    }
    if (bindState !== BIND_STATE_BOUND) {
      enqueue(this, FunctionPrototypeBind.$call(this.addMembership, this, multicastAddress, interfaceAddress));
      return;
    }
    handle.socket.addMembership(multicastAddress, interfaceAddress);
  }

  dropMembership(multicastAddress: string, interfaceAddress?: string): void {
    if (!multicastAddress) {
      throw $ERR_MISSING_ARGS("multicastAddress");
    }
    validateString(multicastAddress, "multicastAddress");
    if (typeof interfaceAddress !== "undefined") {
      validateString(interfaceAddress, "interfaceAddress");
    }
    const { handle } = this[kStateSymbol];
    if (!handle?.socket) {
      if (!isIP(multicastAddress)) {
        throw EINVAL("dropMembership");
      }
      throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
    }
    handle.socket.dropMembership(multicastAddress, interfaceAddress);
  }

  addSourceSpecificMembership(sourceAddress: string, groupAddress: string, interfaceAddress?: string): void {
    validateString(sourceAddress, "sourceAddress");
    validateString(groupAddress, "groupAddress");
    if (typeof interfaceAddress !== "undefined") {
      validateString(interfaceAddress, "interfaceAddress");
    }

    const { handle, bindState } = this[kStateSymbol];
    if (!handle?.socket) {
      if (!isIP(sourceAddress) || !isIP(groupAddress)) {
        throw EINVAL("addSourceSpecificMembership");
      }
      throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
    }
    if (bindState === BIND_STATE_UNBOUND) {
      this.bind(0);
    }
    if (bindState !== BIND_STATE_BOUND) {
      enqueue(this, FunctionPrototypeBind.$call(this.addSourceSpecificMembership, this, sourceAddress, groupAddress, interfaceAddress));
      return;
    }
    handle.socket.addSourceSpecificMembership(sourceAddress, groupAddress, interfaceAddress);
  }

  dropSourceSpecificMembership(sourceAddress: string, groupAddress: string, interfaceAddress?: string): void {
    validateString(sourceAddress, "sourceAddress");
    validateString(groupAddress, "groupAddress");
    if (typeof interfaceAddress !== "undefined") {
      validateString(interfaceAddress, "interfaceAddress");
    }

    const { handle, bindState } = this[kStateSymbol];
    if (!handle?.socket) {
      if (!isIP(sourceAddress) || !isIP(groupAddress)) {
        throw EINVAL("dropSourceSpecificMembership");
      }
      throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
    }
    if (bindState === BIND_STATE_UNBOUND) {
      this.bind(0);
    }
    if (bindState !== BIND_STATE_BOUND) {
      enqueue(this, FunctionPrototypeBind.$call(this.dropSourceSpecificMembership, this, sourceAddress, groupAddress, interfaceAddress));
      return;
    }
    handle.socket.dropSourceSpecificMembership(sourceAddress, groupAddress, interfaceAddress);
  }

  ref(): this {
    const socket = this[kStateSymbol].handle?.socket;

    if (socket) socket.ref();

    return this;
  }

  unref(): this {
    const socket = this[kStateSymbol].handle?.socket;

    if (socket) {
      socket.unref();
    } else {
      this[kStateSymbol].unrefOnBind = true;
    }

    return this;
  }

  setRecvBufferSize(size: number): void {
    bufferSize(this, size, RECV_BUFFER);
  }

  setSendBufferSize(size: number): void {
    bufferSize(this, size, SEND_BUFFER);
  }

  getRecvBufferSize(): number {
    return bufferSize(this, 0, RECV_BUFFER);
  }

  getSendBufferSize(): number {
    return bufferSize(this, 0, SEND_BUFFER);
  }

  getSendQueueSize(): number {
    return 0;
    // return this[kStateSymbol].handle.getSendQueueSize();
  }

  getSendQueueCount(): number {
    return 0;
    // return this[kStateSymbol].handle.getSendQueueCount();
  }

  async [SymbolAsyncDispose](): Promise<void> {
    if (!this[kStateSymbol].handle?.socket) {
      return Promise.resolve(); // Already closed or never opened
    }
    const { promise, resolve, reject } = $newPromiseCapability(Promise);
    // The 'close' event listener callback takes no arguments.
    this.close(() => {
      // If an error occurred *before* close was called and prevented it,
      // the promise might need rejection, but the 'close' event itself
      // doesn't signify an error state in Node dgram.
      // We assume successful close if the event fires.
      resolve();
    });
    // If close() itself throws synchronously, the promise constructor might handle it,
    // but this specific callback won't receive an error.
    return promise;
  }

  disconnect(): void {
    const state = this[kStateSymbol];
    if (state.connectState !== CONNECT_STATE_CONNECTED) throw $ERR_SOCKET_DGRAM_NOT_CONNECTED();

    if (state.handle?.socket) {
      disconnectFn.$call(state.handle.socket);
    }
    state.connectState = CONNECT_STATE_DISCONNECTED;
  }

  // Deprecated private APIs are defined below using Object.defineProperty
}

function createSocket(typeOrOptions: "udp4" | "udp6" | SocketOptions, listener?: (msg: Buffer, rinfo: RemoteInfo) => void) {
  return new Socket(typeOrOptions, listener);
}

function bufferSize(self: Socket, size, _buffer) {
  if (size >>> 0 !== size) throw $ERR_SOCKET_BAD_BUFFER_SIZE();

  const ctx = {};
  // const ret = self[kStateSymbol].handle.bufferSize(size, buffer, ctx);
  const ret = 1 << 19; // common buffer for all sockets is fixed at 512KiB
  if (ret === undefined) {
    throw new ERR_SOCKET_BUFFER_SIZE(ctx);
  }
  return ret;
}

function _connect(this: Socket, port, address, callback) {
  const state = this[kStateSymbol];
  if (callback) this.once("connect", callback);

  const afterDns = (ex, ip) => {
    defaultTriggerAsyncIdScope(this[async_id_symbol], doConnect, ex, this, ip, address, port, callback);
  };

  state.handle!.lookup(address, afterDns);
}

const connectFn = $newZigFunction("udp_socket.zig", "UDPSocket.jsConnect", 2);

function doConnect(ex: Error | null, self: Socket, ip, address, port, callback) {
  const state = self[kStateSymbol];
  if (!state.handle) return;

  if (!ex) {
    try {
      connectFn.$call(state.handle.socket, ip, port);
    } catch (e) {
      ex = e as Error;
    }
  }

  if (ex) {
    state.connectState = CONNECT_STATE_DISCONNECTED;
    return process.nextTick(() => {
      if (callback) {
        self.removeListener("connect", callback);
        callback(ex);
      } else {
        self.emit("error", ex);
      }
    });
  }

  state.connectState = CONNECT_STATE_CONNECTED;
  process.nextTick(() => self.emit("connect"));
}

const disconnectFn = $newZigFunction("udp_socket.zig", "UDPSocket.jsDisconnect", 0);

function sliceBuffer(buffer, offset, length) {
  if (typeof buffer === "string") {
    buffer = Buffer.from(buffer);
  } else if (!ArrayBuffer.isView(buffer)) {
    throw $ERR_INVALID_ARG_TYPE("buffer", ["string", "Buffer", "TypedArray", "DataView"], buffer);
  }

  offset = offset >>> 0;
  length = length >>> 0;
  if (offset > buffer.byteLength) {
    throw $ERR_BUFFER_OUT_OF_BOUNDS("offset");
  }

  if (offset + length > buffer.byteLength) {
    throw $ERR_BUFFER_OUT_OF_BOUNDS("length");
  }

  return Buffer.from(buffer.buffer, buffer.byteOffset + offset, length);
}

function fixBufferList(list) {
  const newlist = new Array(list.length);

  for (let i = 0, l = list.length; i < l; i++) {
    const buf = list[i];
    if (typeof buf === "string") newlist[i] = Buffer.from(buf);
    else if (!ArrayBuffer.isView(buf)) return null;
    else newlist[i] = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  return newlist;
}

function enqueue(self: Socket, toEnqueue: Function) {
  const state = self[kStateSymbol];

  // If the send queue hasn't been initialized yet, do it, and install an
  // event handler that flushes the send queue after binding is complete.
  if (state.queue === undefined) {
    state.queue = [];
    self.once(EventEmitter.errorMonitor, onListenError);
    self.once("listening", onListenSuccess);
  }
  state.queue.push(toEnqueue);
}

function onListenSuccess(this: Socket) {
  this.removeListener(EventEmitter.errorMonitor, onListenError);
  clearQueue.$call(this);
}

function onListenError(this: Socket, _err) {
  this.removeListener("listening", onListenSuccess);
  this[kStateSymbol].queue = undefined;
}

function clearQueue(this: Socket) {
  const state = this[kStateSymbol];
  const queue = state.queue;
  state.queue = undefined;

  // Flush the send queue.
  if (queue) {
    for (const queueEntry of queue) queueEntry();
  }
}

function doSend(ex, self: Socket, ip, list, address, port, callback) {
  const state = self[kStateSymbol];

  if (ex) {
    if (typeof callback === "function") {
      process.nextTick(callback, ex);
      return;
    }

    process.nextTick(() => self.emit("error", ex));
    return;
  }
  if (!state.handle) {
    return;
  }
  const socket = state.handle.socket;
  if (!socket) {
    return;
  }

  let err: Error | null = null;
  let success = false;
  let data;
  if (list === undefined) data = new $Buffer(0);
  else if (Array.isArray(list) && list.length === 1) {
    const { buffer, byteOffset, byteLength } = list[0];
    data = new $Buffer(buffer).slice(byteOffset).slice(0, byteLength);
  } else data = Buffer.concat(list);
  try {
    if (port) {
      success = socket.send(data, port, ip);
    } else {
      success = socket.send(data);
    }
  } catch (e) {
    err = e as Error;
  }
  // TODO check if this makes sense
  if (callback) {
    if (err) {
      (err as any).address = ip;
      (err as any).port = port;
      err.message = `send ${err.code} ${ip}:${port}`;
      process.nextTick(callback, err);
    } else {
      const sent = success ? data.byteLength : 0;
      process.nextTick(callback, null, sent);
    }
  }

  /*
  const req = new SendWrap();
  req.list = list; // Keep reference alive.
  req.address = address;
  req.port = port;
  if (callback) {
    req.callback = callback;
    req.oncomplete = afterSend;
  }

  let err;
  if (port) err = state.handle.send(req, list, list.length, port, ip, !!callback);
  else err = state.handle.send(req, list, list.length, !!callback);

  if (err >= 1) {
    // Synchronous finish. The return code is msg_length + 1 so that we can
    // distinguish between synchronous success and asynchronous success.
    if (callback) process.nextTick(callback, null, err - 1);
    return;
  }

  if (err && callback) {
    // Don't emit as error, dgram_legacy.js compatibility
    const ex = new ExceptionWithHostPort(err, 'send', address, port);
    process.nextTick(callback, ex);
  }
  */
}

/*
function afterSend(err, sent) {
  if (err) {
    err = new ExceptionWithHostPort(err, 'send', this.address, this.port);
  } else {
    err = null;
  }

  this.callback(err, sent);
}
*/

function socketCloseNT(self) {
  self.emit("close");
}

// Deprecated private APIs.
ObjectDefineProperty(Socket.prototype, "_handle", {
  get: deprecate(
    function (this: Socket) {
      return this[kStateSymbol].handle;
    },
    "Socket.prototype._handle is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (this: Socket, val) {
      this[kStateSymbol].handle = val;
    },
    "Socket.prototype._handle is deprecated",
    "DEP0112",
  ),
});

ObjectDefineProperty(Socket.prototype, "_receiving", {
  get: deprecate(
    function (this: Socket) {
      return this[kStateSymbol].receiving;
    },
    "Socket.prototype._receiving is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (this: Socket, val) {
      this[kStateSymbol].receiving = val as boolean; // Fix: Cast to boolean
    },
    "Socket.prototype._receiving is deprecated",
    "DEP0112",
  ),
});

ObjectDefineProperty(Socket.prototype, "_bindState", {
  get: deprecate(
    function (this: Socket) {
      return this[kStateSymbol].bindState;
    },
    "Socket.prototype._bindState is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (this: Socket, val) {
      this[kStateSymbol].bindState = val;
    },
    "Socket.prototype._bindState is deprecated",
    "DEP0112",
  ),
});

ObjectDefineProperty(Socket.prototype, "_queue", {
  get: deprecate(
    function (this: Socket) {
      return this[kStateSymbol].queue;
    },
    "Socket.prototype._queue is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (this: Socket, val) {
      this[kStateSymbol].queue = val;
    },
    "Socket.prototype._queue is deprecated",
    "DEP0112",
  ),
});

ObjectDefineProperty(Socket.prototype, "_reuseAddr", {
  get: deprecate(
    function (this: Socket) {
      return this[kStateSymbol].reuseAddr;
    },
    "Socket.prototype._reuseAddr is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (this: Socket, val) {
      this[kStateSymbol].reuseAddr = val as boolean; // Fix: Cast to boolean
    },
    "Socket.prototype._reuseAddr is deprecated",
    "DEP0112",
  ),
});

function healthCheck(socket: Socket) {
  if (!socket[kStateSymbol].handle) {
    throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
  }
}

ObjectDefineProperty(Socket.prototype, "_healthCheck", {
  value: deprecate(
    function (this: Socket) {
      healthCheck(this);
    },
    "Socket.prototype._healthCheck() is deprecated",
    "DEP0112",
  ),
});

function stopReceiving(socket: Socket) {
  const state = socket[kStateSymbol];

  if (!state.receiving) return;

  // state.handle.recvStop();
  state.receiving = false;
}

ObjectDefineProperty(Socket.prototype, "_stopReceiving", {
  value: deprecate(
    function (this: Socket) {
      stopReceiving(this);
    },
    "Socket.prototype._stopReceiving() is deprecated",
    "DEP0112",
  ),
});

/*
function _createSocketHandle(address, port, addressType, fd, flags) {
  const handle = newHandle(addressType);
  let err;

  if (isInt32(fd) && fd > 0) {
    const type = guessHandleType(fd);
    if (type !== 'UDP') {
      err = UV_EINVAL;
    } else {
      err = handle.open(fd);
    }
  } else if (port || address) {
    err = handle.bind(address, port || 0, flags);
  }

  if (err) {
    handle.close();
    return err;
  }

  return handle;
}


// Legacy alias on the C++ wrapper object. This is not public API, so we may
// want to runtime-deprecate it at some point. There's no hurry, though.
ObjectDefineProperty(UDP.prototype, 'owner', {
  __proto__: null,
  get() { return this[kOwnerSymbol]; },
  set(v) { return this[kOwnerSymbol] = v; },
});
*/

export default {
  /*
  _createSocketHandle: deprecate(
    _createSocketHandle,
    'dgram._createSocketHandle() is deprecated',
    'DEP0112',
  ),
  */
  createSocket,
  Socket,
};