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

const kStateSymbol = Symbol("state symbol");
const async_id_symbol = Symbol("async_id_symbol");

const { hideFromStack, throwNotImplemented } = require("internal/shared");
const { ERR_SOCKET_BAD_TYPE } = require("internal/errors");

const {
  FunctionPrototypeBind,
  ObjectSetPrototypeOf,
  SymbolAsyncDispose,
  SymbolDispose,
  StringPrototypeTrim,
  NumberIsNaN,
} = require("internal/primordials");

const EventEmitter = require("node:events");

class ERR_OUT_OF_RANGE extends Error {
  constructor(argumentName, range, received) {
    super(`The value of "${argumentName}" is out of range. It must be ${range}. Received ${received}`);
    this.code = "ERR_OUT_OF_RANGE";
  }
}

class ERR_BUFFER_OUT_OF_BOUNDS extends Error {
  constructor() {
    super("Buffer offset or length is out of bounds");
    this.code = "ERR_BUFFER_OUT_OF_BOUNDS";
  }
}

class ERR_INVALID_ARG_TYPE extends Error {
  constructor(argName, expected, actual) {
    super(`The "${argName}" argument must be of type ${expected}. Received type ${typeof actual}`);
    this.code = "ERR_INVALID_ARG_TYPE";
  }
}

class ERR_MISSING_ARGS extends Error {
  constructor(argName) {
    super(`The "${argName}" argument is required`);
    this.code = "ERR_MISSING_ARGS";
  }
}

class ERR_SOCKET_ALREADY_BOUND extends Error {
  constructor() {
    super("Socket is already bound");
    this.code = "ERR_SOCKET_ALREADY_BOUND";
  }
}

class ERR_SOCKET_BAD_BUFFER_SIZE extends Error {
  constructor() {
    super("Buffer size must be a number");
    this.code = "ERR_SOCKET_BAD_BUFFER_SIZE";
  }
}

class ERR_SOCKET_BUFFER_SIZE extends Error {
  constructor(ctx) {
    super(`Invalid buffer size: ${ctx}`);
    this.code = "ERR_SOCKET_BUFFER_SIZE";
  }
}

class ERR_SOCKET_DGRAM_IS_CONNECTED extends Error {
  constructor() {
    super("Socket is connected");
    this.code = "ERR_SOCKET_DGRAM_IS_CONNECTED";
  }
}

class ERR_SOCKET_DGRAM_NOT_CONNECTED extends Error {
  constructor() {
    super("Socket is not connected");
    this.code = "ERR_SOCKET_DGRAM_NOT_CONNECTED";
  }
}

class ERR_SOCKET_BAD_PORT extends Error {
  constructor(name, port, allowZero) {
    super(`Invalid ${name}: ${port}. Ports must be >= 0 and <= 65535. ${allowZero ? "0" : ""}`);
    this.code = "ERR_SOCKET_BAD_PORT";
  }
}

class ERR_SOCKET_DGRAM_NOT_RUNNING extends Error {
  constructor() {
    super("Socket is not running");
    this.code = "ERR_SOCKET_DGRAM_NOT_RUNNING";
  }
}

function isInt32(value) {
  return value === (value | 0);
}

function validateAbortSignal(signal, name) {
  if (signal !== undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
}
hideFromStack(validateAbortSignal);

function validateString(value, name) {
  if (typeof value !== "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
}
hideFromStack(validateString);

function validateNumber(value, name, min?, max?) {
  if (typeof value !== "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);

  if (
    (min != null && value < min) ||
    (max != null && value > max) ||
    ((min != null || max != null) && NumberIsNaN(value))
  ) {
    throw new ERR_OUT_OF_RANGE(
      name,
      `${min != null ? `>= ${min}` : ""}${min != null && max != null ? " && " : ""}${max != null ? `<= ${max}` : ""}`,
      value,
    );
  }
}
hideFromStack(validateNumber);

function validatePort(port, name = "Port", allowZero = true) {
  if (
    (typeof port !== "number" && typeof port !== "string") ||
    (typeof port === "string" && StringPrototypeTrim(port).length === 0) ||
    +port !== +port >>> 0 ||
    port > 0xffff ||
    (port === 0 && !allowZero)
  ) {
    throw new ERR_SOCKET_BAD_PORT(name, port, allowZero);
  }
  return port | 0;
}
hideFromStack(validatePort);

function validateFunction(value, name) {
  if (typeof value !== "function") throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
}
hideFromStack(validateFunction);

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

let dns;

function newHandle(type, lookup) {
  if (lookup === undefined) {
    if (dns === undefined) {
      dns = require("node:dns");
    }

    lookup = dns.lookup;
  } else {
    validateFunction(lookup, "lookup");
  }

  const handle = {};
  if (type === "udp4") {
    handle.lookup = FunctionPrototypeBind(lookup4, handle, lookup);
  } else if (type === "udp6") {
    handle.lookup = FunctionPrototypeBind(lookup6, handle, lookup);
  } else {
    throw new ERR_SOCKET_BAD_TYPE();
  }

  return handle;
}

let udpSocketChannel;

function Socket(type, listener) {
  EventEmitter.$call(this);
  let lookup;
  let recvBufferSize;
  let sendBufferSize;

  let options;
  if (type !== null && typeof type === "object") {
    options = type;
    type = options.type;
    lookup = options.lookup;
    recvBufferSize = options.recvBufferSize;
    sendBufferSize = options.sendBufferSize;
  }

  const handle = newHandle(type, lookup);

  // this[async_id_symbol] = handle.getAsyncId();
  this.type = type;

  if (typeof listener === "function") this.on("message", listener);

  this[kStateSymbol] = {
    handle,
    receiving: false,
    bindState: BIND_STATE_UNBOUND,
    connectState: CONNECT_STATE_DISCONNECTED,
    queue: undefined,
    reuseAddr: options && options.reuseAddr, // Use UV_UDP_REUSEADDR if true.
    ipv6Only: options && options.ipv6Only,
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
Socket.prototype = {};
ObjectSetPrototypeOf(Socket.prototype, EventEmitter.prototype);
ObjectSetPrototypeOf(Socket, EventEmitter);

function createSocket(type, listener) {
  return new Socket(type, listener);
}

function bufferSize(self, size, buffer) {
  if (size >>> 0 !== size) throw new ERR_SOCKET_BAD_BUFFER_SIZE();

  const ctx = {};
  // const ret = self[kStateSymbol].handle.bufferSize(size, buffer, ctx);
  const ret = 1 << 19; // common buffer for all sockets is fixed at 512KiB
  if (ret === undefined) {
    throw new ERR_SOCKET_BUFFER_SIZE(ctx);
  }
  return ret;
}

Socket.prototype.bind = function (port_, address_ /* , callback */) {
  let port = port_;

  const state = this[kStateSymbol];

  if (state.bindState !== BIND_STATE_UNBOUND) throw new ERR_SOCKET_ALREADY_BOUND();

  state.bindState = BIND_STATE_BINDING;

  const cb = arguments.length && arguments[arguments.length - 1];
  if (typeof cb === "function") {
    function removeListeners() {
      this.removeListener("error", removeListeners);
      this.removeListener("listening", onListening);
    }

    function onListening() {
      removeListeners.$call(this);
      cb.$call(this);
    }

    this.on("error", removeListeners);
    this.on("listening", onListening);
  }

  if (port !== null && typeof port === "object" && typeof port.recvStart === "function") {
    throwNotImplemented("Socket.prototype.bind(handle)");
    /*
    replaceHandle(this, port);
    startListening(this);
    return this;
    */
  }

  // Open an existing fd instead of creating a new one.
  if (port !== null && typeof port === "object" && isInt32(port.fd) && port.fd > 0) {
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
  let exclusive;

  if (port !== null && typeof port === "object") {
    address = port.address || "";
    exclusive = !!port.exclusive;
    port = port.port;
  } else {
    address = typeof address_ === "function" ? "" : address_;
    exclusive = false;
  }

  // Defaulting address for bind to all interfaces
  if (!address) {
    if (this.type === "udp4") address = "0.0.0.0";
    else address = "::";
  }

  // Resolve address first
  state.handle.lookup(address, (err, ip) => {
    if (!state.handle) return; // Handle has been closed in the mean time

    if (err) {
      state.bindState = BIND_STATE_UNBOUND;
      this.emit("error", err);
      return;
    }

    let flags = 0;
    if (state.reuseAddr) flags |= 0; //UV_UDP_REUSEADDR;
    if (state.ipv6Only) flags |= 0; //UV_UDP_IPV6ONLY;

    // TODO flags
    const family = this.type === "udp4" ? "IPv4" : "IPv6";
    Bun.udpSocket({
      hostname: ip,
      port: port || 0,
      socket: {
        data: (_socket, data, port, address) => {
          this.emit("message", data, {
            port: port,
            address: address,
            size: data.length,
            // TODO check if this is correct
            family,
          });
        },
        error: (_socket, error) => {
          this.emit("error", error);
        },
      },
    }).$then(
      socket => {
        if (state.unrefOnBind) {
          socket.unref();
          state.unrefOnBind = false;
        }
        state.handle.socket = socket;
        state.receiving = true;
        state.bindState = BIND_STATE_BOUND;

        this.emit("listening");
      },
      err => {
        state.bindState = BIND_STATE_UNBOUND;
        this.emit("error", err);
      },
    );
  });

  return this;
};

Socket.prototype.connect = function (port, address, callback) {
  port = validatePort(port, "Port", false);
  if (typeof address === "function") {
    callback = address;
    address = "";
  } else if (address === undefined) {
    address = "";
  }

  validateString(address, "address");

  const state = this[kStateSymbol];

  if (state.connectState !== CONNECT_STATE_DISCONNECTED) throw new ERR_SOCKET_DGRAM_IS_CONNECTED();

  state.connectState = CONNECT_STATE_CONNECTING;
  if (state.bindState === BIND_STATE_UNBOUND) this.bind({ port: 0, exclusive: true }, null);

  if (state.bindState !== BIND_STATE_BOUND) {
    enqueue(this, FunctionPrototypeBind(_connect, this, port, address, callback));
    return;
  }

  _connect.$apply(this, [port, address, callback]);
};

function _connect(port, address, callback) {
  const state = this[kStateSymbol];
  if (callback) this.once("connect", callback);

  const afterDns = (ex, ip) => {
    defaultTriggerAsyncIdScope(this[async_id_symbol], doConnect, ex, this, ip, address, port, callback);
  };

  state.handle.lookup(address, afterDns);
}

const connectFn = $newZigFunction("udp_socket.zig", "UDPSocket.jsConnect", 2);

function doConnect(ex, self, ip, address, port, callback) {
  const state = self[kStateSymbol];
  if (!state.handle) return;

  if (!ex) {
    try {
      connectFn.$call(state.handle.socket, ip, port);
    } catch (e) {
      ex = e;
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

Socket.prototype.disconnect = function () {
  const state = this[kStateSymbol];
  if (state.connectState !== CONNECT_STATE_CONNECTED) throw new ERR_SOCKET_DGRAM_NOT_CONNECTED();

  disconnectFn.$call(state.handle.socket);
  state.connectState = CONNECT_STATE_DISCONNECTED;
};

// Thin wrapper around `send`, here for compatibility with dgram_legacy.js
Socket.prototype.sendto = function (buffer, offset, length, port, address, callback) {
  validateNumber(offset, "offset");
  validateNumber(length, "length");
  validateNumber(port, "port");
  validateString(address, "address");

  this.send(buffer, offset, length, port, address, callback);
};

function sliceBuffer(buffer, offset, length) {
  if (typeof buffer === "string") {
    buffer = Buffer.from(buffer);
  } else if (!ArrayBuffer.isView(buffer)) {
    throw new ERR_INVALID_ARG_TYPE("buffer", ["Buffer", "TypedArray", "DataView", "string"], buffer);
  }

  offset = offset >>> 0;
  length = length >>> 0;
  if (offset > buffer.byteLength) {
    throw new ERR_BUFFER_OUT_OF_BOUNDS("offset");
  }

  if (offset + length > buffer.byteLength) {
    throw new ERR_BUFFER_OUT_OF_BOUNDS("length");
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

function enqueue(self, toEnqueue) {
  const state = self[kStateSymbol];

  // If the send queue hasn't been initialized yet, do it, and install an
  // event handler that flushes the send queue after binding is done.
  if (state.queue === undefined) {
    state.queue = [];
    self.once(EventEmitter.errorMonitor, onListenError);
    self.once("listening", onListenSuccess);
  }
  state.queue.push(toEnqueue);
}

function onListenSuccess() {
  this.removeListener(EventEmitter.errorMonitor, onListenError);
  clearQueue.$call(this);
}

function onListenError(err) {
  this.removeListener("listening", onListenSuccess);
  this[kStateSymbol].queue = undefined;
}

function clearQueue() {
  const state = this[kStateSymbol];
  const queue = state.queue;
  state.queue = undefined;

  // Flush the send queue.
  for (const queueEntry of queue) queueEntry();
}

// valid combinations
// For connectionless sockets
// send(buffer, offset, length, port, address, callback)
// send(buffer, offset, length, port, address)
// send(buffer, offset, length, port, callback)
// send(buffer, offset, length, port)
// send(bufferOrList, port, address, callback)
// send(bufferOrList, port, address)
// send(bufferOrList, port, callback)
// send(bufferOrList, port)
// For connected sockets
// send(buffer, offset, length, callback)
// send(buffer, offset, length)
// send(bufferOrList, callback)
// send(bufferOrList)
Socket.prototype.send = function (buffer, offset, length, port, address, callback) {
  let list;
  const state = this[kStateSymbol];
  const connected = state.connectState === CONNECT_STATE_CONNECTED;
  if (!connected) {
    if (address || (port && typeof port !== "function")) {
      buffer = sliceBuffer(buffer, offset, length);
    } else {
      callback = port;
      port = offset;
      address = length;
    }
  } else {
    if (typeof length === "number") {
      buffer = sliceBuffer(buffer, offset, length);
      if (typeof port === "function") {
        callback = port;
        port = null;
      }
    } else {
      callback = offset;
    }

    if (port || address) throw new ERR_SOCKET_DGRAM_IS_CONNECTED();
  }

  if (!Array.isArray(buffer)) {
    if (typeof buffer === "string") {
      list = [Buffer.from(buffer)];
    } else if (!ArrayBuffer.isView(buffer)) {
      throw new ERR_INVALID_ARG_TYPE("buffer", ["Buffer", "TypedArray", "DataView", "string"], buffer);
    } else {
      list = [buffer];
    }
  } else if (!(list = fixBufferList(buffer))) {
    throw new ERR_INVALID_ARG_TYPE("buffer list arguments", ["Buffer", "TypedArray", "DataView", "string"], buffer);
  }

  if (!connected) port = validatePort(port, "Port", false);

  // Normalize callback so it's either a function or undefined but not anything
  // else.
  if (typeof callback !== "function") callback = undefined;

  if (typeof address === "function") {
    callback = address;
    address = undefined;
  } else if (address != null) {
    validateString(address, "address");
  }

  if (state.bindState === BIND_STATE_UNBOUND) this.bind({ port: 0, exclusive: true }, null);

  if (list.length === 0) list.push(Buffer.alloc(0));

  // If the socket hasn't been bound yet, push the outbound packet onto the
  // send queue and send after binding is complete.
  if (state.bindState !== BIND_STATE_BOUND) {
    enqueue(this, FunctionPrototypeBind(this.send, this, list, port, address, callback));
    return;
  }

  const afterDns = (ex, ip) => {
    defaultTriggerAsyncIdScope(this[async_id_symbol], doSend, ex, this, ip, list, address, port, callback);
  };

  if (!connected) {
    state.handle.lookup(address, afterDns);
  } else {
    afterDns(null, null);
  }
};

function doSend(ex, self, ip, list, address, port, callback) {
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

  let err = null;
  let success = false;
  const data = Buffer.concat(list);
  try {
    if (port) {
      success = socket.send(data, port, ip);
    } else {
      success = socket.send(data);
    }
  } catch (e) {
    err = e;
  }
  // TODO check if this makes sense
  if (callback) {
    if (err) {
      process.nextTick(callback, err);
    } else {
      const sent = success ? data.length : 0;
      process.nextTick(callback, null, sent);
    }
  }

  /*
  const req = new SendWrap();
  req.list = list;  // Keep reference alive.
  req.address = address;
  req.port = port;
  if (callback) {
    req.callback = callback;
    req.oncomplete = afterSend;
  }

  let err;
  if (port)
    err = state.handle.send(req, list, list.length, port, ip, !!callback);
  else
    err = state.handle.send(req, list, list.length, !!callback);

  if (err >= 1) {
    // Synchronous finish. The return code is msg_length + 1 so that we can
    // distinguish between synchronous success and asynchronous success.
    if (callback)
      process.nextTick(callback, null, err - 1);
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

Socket.prototype.close = function (callback) {
  const state = this[kStateSymbol];
  const queue = state.queue;

  if (typeof callback === "function") this.on("close", callback);

  if (queue !== undefined) {
    queue.push(FunctionPrototypeBind(this.close, this));
    return this;
  }

  state.receiving = false;
  state.handle.socket?.close();
  state.handle.socket = undefined;
  defaultTriggerAsyncIdScope(this[async_id_symbol], process.nextTick, socketCloseNT, this);

  return this;
};

Socket.prototype[SymbolAsyncDispose] = async function () {
  if (!this[kStateSymbol].handle.socket) {
    return;
  }
  const { promise, resolve, reject } = $newPromiseCapability(Promise);
  this.close(err => {
    if (err) {
      reject(err);
    } else {
      resolve();
    }
  });

  return promise;
};

function socketCloseNT(self) {
  self.emit("close");
}

Socket.prototype.address = function () {
  const addr = this[kStateSymbol].handle.socket?.address;
  if (!addr) throw new ERR_SOCKET_DGRAM_NOT_RUNNING();
  return addr;
};

Socket.prototype.remoteAddress = function () {
  const state = this[kStateSymbol];
  const socket = state.handle.socket;

  if (!socket) throw new ERR_SOCKET_DGRAM_NOT_RUNNING();

  if (state.connectState !== CONNECT_STATE_CONNECTED) throw new ERR_SOCKET_DGRAM_NOT_CONNECTED();

  if (!socket.remoteAddress) throw new ERR_SOCKET_DGRAM_NOT_CONNECTED();

  return socket.remoteAddress;
};

Socket.prototype.setBroadcast = function (arg) {
  throwNotImplemented("setBroadcast", 10381);
  /*
  const err = this[kStateSymbol].handle.setBroadcast(arg ? 1 : 0);
  if (err) {
    throw new ErrnoException(err, 'setBroadcast');
  }
  */
};

Socket.prototype.setTTL = function (ttl) {
  throwNotImplemented("setTTL", 10381);
  /*
  validateNumber(ttl, 'ttl');

  const err = this[kStateSymbol].handle.setTTL(ttl);
  if (err) {
    throw new ErrnoException(err, 'setTTL');
  }

  return ttl;
  */
};

Socket.prototype.setMulticastTTL = function (ttl) {
  throwNotImplemented("setMulticastTTL", 10381);
  /*
  validateNumber(ttl, 'ttl');

  const err = this[kStateSymbol].handle.setMulticastTTL(ttl);
  if (err) {
    throw new ErrnoException(err, 'setMulticastTTL');
  }

  return ttl;
  */
};

Socket.prototype.setMulticastLoopback = function (arg) {
  throwNotImplemented("setMulticastLoopback", 10381);
  /*
  const err = this[kStateSymbol].handle.setMulticastLoopback(arg ? 1 : 0);
  if (err) {
    throw new ErrnoException(err, 'setMulticastLoopback');
  }

  return arg; // 0.4 compatibility
  */
};

Socket.prototype.setMulticastInterface = function (interfaceAddress) {
  throwNotImplemented("setMulticastInterface", 10381);
  /*
  validateString(interfaceAddress, 'interfaceAddress');

  const err = this[kStateSymbol].handle.setMulticastInterface(interfaceAddress);
  if (err) {
    throw new ErrnoException(err, 'setMulticastInterface');
  }
  */
};

Socket.prototype.addMembership = function (multicastAddress, interfaceAddress) {
  throwNotImplemented("addMembership", 10381);
  /*
  if (!multicastAddress) {
    throw new ERR_MISSING_ARGS('multicastAddress');
  }

  const { handle } = this[kStateSymbol];
  const err = handle.addMembership(multicastAddress, interfaceAddress);
  if (err) {
    throw new ErrnoException(err, 'addMembership');
  }
  */
};

Socket.prototype.dropMembership = function (multicastAddress, interfaceAddress) {
  throwNotImplemented("dropMembership", 10381);
  /*
  if (!multicastAddress) {
    throw new ERR_MISSING_ARGS('multicastAddress');
  }

  const { handle } = this[kStateSymbol];
  const err = handle.dropMembership(multicastAddress, interfaceAddress);
  if (err) {
    throw new ErrnoException(err, 'dropMembership');
  }
  */
};

Socket.prototype.addSourceSpecificMembership = function (sourceAddress, groupAddress, interfaceAddress) {
  throwNotImplemented("addSourceSpecificMembership", 10381);
  /*
  validateString(sourceAddress, 'sourceAddress');
  validateString(groupAddress, 'groupAddress');

  const err =
    this[kStateSymbol].handle.addSourceSpecificMembership(sourceAddress,
                                                          groupAddress,
                                                          interfaceAddress);
  if (err) {
    throw new ErrnoException(err, 'addSourceSpecificMembership');
  }
  */
};

Socket.prototype.dropSourceSpecificMembership = function (sourceAddress, groupAddress, interfaceAddress) {
  throwNotImplemented("dropSourceSpecificMembership", 10381);
  /*
  validateString(sourceAddress, 'sourceAddress');
  validateString(groupAddress, 'groupAddress');

  const err =
    this[kStateSymbol].handle.dropSourceSpecificMembership(sourceAddress,
                                                           groupAddress,
                                                           interfaceAddress);
  if (err) {
    throw new ErrnoException(err, 'dropSourceSpecificMembership');
  }
  */
};

Socket.prototype.ref = function () {
  const socket = this[kStateSymbol].handle?.socket;

  if (socket) socket.ref();

  return this;
};

Socket.prototype.unref = function () {
  const socket = this[kStateSymbol].handle?.socket;

  if (socket) {
    socket.unref();
  } else {
    this[kStateSymbol].unrefOnBind = true;
  }

  return this;
};

Socket.prototype.setRecvBufferSize = function (size) {
  bufferSize(this, size, RECV_BUFFER);
};

Socket.prototype.setSendBufferSize = function (size) {
  bufferSize(this, size, SEND_BUFFER);
};

Socket.prototype.getRecvBufferSize = function () {
  return bufferSize(this, 0, RECV_BUFFER);
};

Socket.prototype.getSendBufferSize = function () {
  return bufferSize(this, 0, SEND_BUFFER);
};

Socket.prototype.getSendQueueSize = function () {
  return 0;
  // return this[kStateSymbol].handle.getSendQueueSize();
};

Socket.prototype.getSendQueueCount = function () {
  return 0;
  // return this[kStateSymbol].handle.getSendQueueCount();
};

// Deprecated private APIs.
/*
ObjectDefineProperty(Socket.prototype, '_handle', {
  __proto__: null,
  get: deprecate(function() {
    return this[kStateSymbol].handle;
  }, 'Socket.prototype._handle is deprecated', 'DEP0112'),
  set: deprecate(function(val) {
    this[kStateSymbol].handle = val;
  }, 'Socket.prototype._handle is deprecated', 'DEP0112'),
});


ObjectDefineProperty(Socket.prototype, '_receiving', {
  __proto__: null,
  get: deprecate(function() {
    return this[kStateSymbol].receiving;
  }, 'Socket.prototype._receiving is deprecated', 'DEP0112'),
  set: deprecate(function(val) {
    this[kStateSymbol].receiving = val;
  }, 'Socket.prototype._receiving is deprecated', 'DEP0112'),
});


ObjectDefineProperty(Socket.prototype, '_bindState', {
  __proto__: null,
  get: deprecate(function() {
    return this[kStateSymbol].bindState;
  }, 'Socket.prototype._bindState is deprecated', 'DEP0112'),
  set: deprecate(function(val) {
    this[kStateSymbol].bindState = val;
  }, 'Socket.prototype._bindState is deprecated', 'DEP0112'),
});


ObjectDefineProperty(Socket.prototype, '_queue', {
  __proto__: null,
  get: deprecate(function() {
    return this[kStateSymbol].queue;
  }, 'Socket.prototype._queue is deprecated', 'DEP0112'),
  set: deprecate(function(val) {
    this[kStateSymbol].queue = val;
  }, 'Socket.prototype._queue is deprecated', 'DEP0112'),
});


ObjectDefineProperty(Socket.prototype, '_reuseAddr', {
  __proto__: null,
  get: deprecate(function() {
    return this[kStateSymbol].reuseAddr;
  }, 'Socket.prototype._reuseAddr is deprecated', 'DEP0112'),
  set: deprecate(function(val) {
    this[kStateSymbol].reuseAddr = val;
  }, 'Socket.prototype._reuseAddr is deprecated', 'DEP0112'),
});


Socket.prototype._healthCheck = deprecate(function() {
  healthCheck(this);
}, 'Socket.prototype._healthCheck() is deprecated', 'DEP0112');


Socket.prototype._stopReceiving = deprecate(function() {
  stopReceiving(this);
}, 'Socket.prototype._stopReceiving() is deprecated', 'DEP0112');

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
  get() { return this[owner_symbol]; },
  set(v) { return this[owner_symbol] = v; },
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
