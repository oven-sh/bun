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

const { kStateSymbol, guessHandleType } = require("internal/dgram");
const kOwnerSymbol = Symbol("owner symbol");
const async_id_symbol = Symbol("async_id_symbol");

const { throwNotImplemented, ErrnoException, ExceptionWithHostPort } = require("internal/shared");
const {
  validateString,
  validateNumber,
  validateFunction,
  validatePort,
  validateAbortSignal,
  validateUint32,
} = require("internal/validators");

const { isIP } = require("internal/net/isIP");

const EventEmitter = require("node:events");

const { deprecate } = require("internal/util/deprecate");

const SymbolDispose = Symbol.dispose;
const SymbolAsyncDispose = Symbol.asyncDispose;
const ObjectDefineProperty = Object.defineProperty;
const FunctionPrototypeBind = Function.prototype.bind;

// Mirrors Node's SystemError shape for ERR_SOCKET_BUFFER_SIZE: name
// "SystemError", an enumerable `info` object, errno/syscall accessors that
// read through to it, a "SystemError [ERR_...]" stack header, and a custom
// inspect that renders the accessor values like Node's SystemError does.
class ERR_SOCKET_BUFFER_SIZE extends Error {
  constructor(ctx) {
    super(`Could not get or set buffer size: ${ctx.syscall} returned ${ctx.code} (${ctx.message})`);
    this.code = "ERR_SOCKET_BUFFER_SIZE";
    ObjectDefineProperty(this, "name", {
      value: "SystemError",
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const stack = this.stack;
    if (typeof stack === "string") {
      const rest = stack.indexOf("\n");
      this.stack = `${this.toString()}${rest === -1 ? "" : stack.slice(rest)}`;
    }
    ObjectDefineProperty(this, "info", { value: ctx, enumerable: true, configurable: true, writable: false });
    ObjectDefineProperty(this, "errno", {
      get() {
        return ctx.errno;
      },
      set(value) {
        ctx.errno = value;
      },
      enumerable: true,
      configurable: true,
    });
    ObjectDefineProperty(this, "syscall", {
      get() {
        return ctx.syscall;
      },
      set(value) {
        ctx.syscall = value;
      },
      enumerable: true,
      configurable: true,
    });
  }

  toString() {
    return `${this.name} [${this.code}]: ${this.message}`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](_recurseTimes, ctx) {
    return require("node:util").inspect(this, {
      ...ctx,
      getters: true,
      customInspect: false,
    });
  }
}

// uv_strerror() text and libuv Windows constants for the buffer-size path.
// On POSIX a native err.errno is already libuv-semantic; on Windows it's
// -(Bun's discriminant), not the -4xxx Node reports, so map by code string.
const kUvErrors = {
  __proto__: null,
  EBADF: [-4083, "bad file descriptor"],
  EINVAL: [-4071, "invalid argument"],
  ENOTSOCK: [-4050, "socket operation on non-socket"],
  ENOBUFS: [-4060, "no buffer space available"],
};

function isInt32(value) {
  return value === (value | 0);
}

// libuv-style negative errnos used where Node reports uv error codes (the POSIX
// values match every supported platform; Windows uses libuv's own values).
// NOT from process.binding("uv"): Bun's ProcessBindingUV.cpp negates the
// COMPILING HOST's <errno.h> value, so on Windows it reports -9/-22/-105
// where Node/libuv report the synthetic -4083/-4071/-4081.
const UV_EBADF = process.platform === "win32" ? -4083 : -9;
const UV_EEXIST = process.platform === "win32" ? -4075 : -17;
const UV_EINVAL = process.platform === "win32" ? -4071 : -22;
// Unlike the codes above, ECANCELED's number differs across the POSIX
// platforms (Linux 125, Darwin 89, FreeBSD 85) and is a libuv-synthetic
// -4081 on Windows, so it has to come from native.
const UV_ECANCELED = $newRustFunction("node_util_binding.rs", "ecanceledErrorCode", 0)();

// Node's --test-udp-no-try-send makes udp_wrap skip uv_udp_try_send so every
// request is counted until its callback runs. Only Node's own tests use it.
const kNoTrySend = Array.prototype.indexOf.$call(process.execArgv, "--test-udp-no-try-send") !== -1;

const getFdFn = $newRustFunction("udp_socket.rs", "UDPSocket.jsGetFd", 0);
// Read-only query of the process-wide DGRAM_FDS registry the native layer
// already maintains, so bind({ fd }) can synchronously report EEXIST like
// libuv's uv_udp_open() without keeping a second per-VM copy of the same fact.
const isFdAdoptedFn = $newRustFunction("udp_socket.rs", "jsDgramIsFdAdopted", 1);
// Fresh getsockname on a live socket's descriptor: the cached `.address`
// getter can be stale for an adopted-but-unbound fd once the kernel
// auto-binds on first sendto(); Node calls getsockname on every address().
const getSockNameFn = $newRustFunction("udp_socket.rs", "jsDgramGetSockNameFd", 1);

let BlockList;
function isBlockList(value) {
  BlockList ??= $rust("node_net_binding.rs", "BlockList");
  return BlockList.isBlockList(value);
}

let cluster;
function lazyLoadCluster() {
  return (cluster ??= require("node:cluster"));
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

  const handle = {
    socket: undefined,
    // Bytes/requests the kernel has not yet accepted — the uv_udp_send fallback
    // queue. A synchronously accepted send (uv_udp_try_send fast path) never
    // touches these, matching Node.
    queueSize: 0,
    queueCount: 0,
    // Requests the kernel refused (send buffer full): flushed by on_drain.
    sendQueue: undefined,
    // Index of the first not-yet-drained sendQueue entry (see handleDrain).
    sendQueueHead: 0,
    send: handleSend,
    drain: handleDrain,
    getSendQueueSize: handleGetSendQueueSize,
    getSendQueueCount: handleGetSendQueueCount,
    get fd() {
      return this.socket ? getFdFn.$call(this.socket) : -1;
    },
  };
  if (type === "udp4") {
    handle.lookup = FunctionPrototypeBind.$call(lookup4, handle, lookup);
  } else if (type === "udp6") {
    handle.lookup = FunctionPrototypeBind.$call(lookup6, handle, lookup);
  } else {
    throw $ERR_SOCKET_BAD_TYPE();
  }

  handle.onmessage = onMessage;

  return handle;
}

// Mirrors the libuv UDP wrap's send(): sentBytes + 1 on synchronous success,
// 0 when queued for the next writable event (callback fires on drain), or a
// negative uv errno / native error. Connected form omits port/address.
function handleSend(req, list, count, port, address, _hasCallback) {
  if (typeof port === "boolean") {
    port = undefined;
    address = undefined;
  }

  const socket = this.socket;
  if (!socket) {
    return UV_EBADF;
  }

  let data;
  if (count === 1) {
    const { buffer, byteOffset, byteLength } = list[0];
    data = new $Buffer(buffer).slice(byteOffset).slice(0, byteLength);
  } else {
    data = Buffer.concat(list);
  }

  // Don't jump the queue: if earlier requests are still waiting for the kernel
  // to accept them, this one goes behind them (libuv's uv_udp_send order).
  if (this.sendQueue !== undefined) {
    return handleQueueSend(this, data, port, address, req);
  }

  let accepted;
  try {
    accepted = port ? socket.send(data, port, address) : socket.send(data);
  } catch (err) {
    // Hand the original error back so the caller keeps the platform-correct
    // code; a numeric return is reserved for libuv-style errno values.
    return err;
  }

  if (!accepted) {
    // Kernel send buffer is full. The native send re-armed writable and
    // on_drain will fire when it clears — queue this request until then like
    // libuv's uv_udp_send() does when uv_udp_try_send() reports EAGAIN.
    return handleQueueSend(this, data, port, address, req);
  }

  if (kNoTrySend) {
    // Emulate uv_udp_send: the datagram was written, but the request stays
    // counted until its callback runs on the next turn. On Windows a
    // synchronously-completed WSASend contributes 0 queued bytes.
    this.queueCount += 1;
    if (process.platform !== "win32") this.queueSize += data.byteLength;
    process.nextTick(completeNoTrySend, this, req, data.byteLength);
    return 0;
  }

  // uv_udp_try_send fast path: the kernel accepted the datagram and Node's
  // wrap returns bytes+1 without ever creating a uv_udp_send_t, so the queue
  // counters stay untouched.
  return data.byteLength + 1;
}

function completeNoTrySend(handle, req, sent) {
  handle.queueCount -= 1;
  if (process.platform !== "win32") handle.queueSize -= sent;
  if (req && typeof req.oncomplete === "function") req.oncomplete(undefined, sent);
}

function handleQueueSend(handle, data, port, address, req) {
  // Capture the length once: `data` is a view over the caller's ArrayBuffer,
  // and a detach between enqueue and completion would report byteLength 0,
  // stranding bytes in getSendQueueSize(). libuv captures uv_buf_t.len the
  // same way.
  const length = data.byteLength;
  handle.sendQueue ??= [];
  handle.sendQueue.push({ data, length, port, address, req });
  handle.queueCount += 1;
  handle.queueSize += length;
  return 0;
}

// Drains queued sends after the kernel signals writable. Consumes from the
// live queue front so a send() from a completion callback lands behind the
// remaining entries (libuv's FIFO order); stops on renewed backpressure.
function handleDrain() {
  const queue = this.sendQueue;
  if (queue === undefined) return;
  // A non-empty queue implies the native socket: entries are only enqueued
  // after handleSend's `!this.socket` guard, and close() flushes the queue in
  // the same breath as it closes the socket.
  const socket = this.socket;
  let head = this.sendQueueHead;
  while (head < queue.length) {
    const entry = queue[head];
    let err;
    let accepted = false;
    try {
      accepted = entry.port ? socket.send(entry.data, entry.port, entry.address) : socket.send(entry.data);
    } catch (e) {
      err = e;
    }
    if (err === undefined && !accepted) {
      // Still full: leave this and everything behind it queued for the next
      // drain (native send has re-armed writable again).
      break;
    }
    queue[head++] = undefined;
    completeQueuedSend(this, entry, err);
  }
  if (head === queue.length) {
    this.sendQueue = undefined;
    this.sendQueueHead = 0;
  } else if (head > 256) {
    // Compact the consumed prefix only once it is worth an O(remaining)
    // splice; doing it on every partial drain is quadratic under sustained
    // backpressure. Same running-index shape (and threshold) as writable's
    // buffered list.
    queue.splice(0, head);
    this.sendQueueHead = 0;
  } else {
    this.sendQueueHead = head;
  }
}

function completeQueuedSend(handle, entry, err) {
  handle.queueCount -= 1;
  handle.queueSize -= entry.length;
  // Next tick, like libuv's uv__udp_run_completed: a throwing or re-entrant
  // callback cannot skip a sibling entry or run inside close()/drain.
  const req = entry.req;
  if (req && typeof req.oncomplete === "function") {
    process.nextTick(runQueuedSendComplete, req, err, err === undefined ? entry.length : 0);
  }
}

function runQueuedSendComplete(req, err, sent) {
  req.oncomplete(err, sent);
}

function handleGetSendQueueSize() {
  return this.queueSize;
}

function handleGetSendQueueCount() {
  return this.queueCount;
}

function onMessage(nread, handle, buf, rinfo) {
  const self = handle[kOwnerSymbol];
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

function Socket(type, listener) {
  EventEmitter.$call(this);
  let lookup;
  let recvBufferSize;
  let sendBufferSize;
  let receiveBlockList;
  let sendBlockList;

  let options;
  if (type !== null && typeof type === "object") {
    options = type;
    type = options.type;
    lookup = options.lookup;
    recvBufferSize = options.recvBufferSize;
    if (recvBufferSize) {
      validateUint32(recvBufferSize, "options.recvBufferSize");
    }
    sendBufferSize = options.sendBufferSize;
    if (sendBufferSize) {
      validateUint32(sendBufferSize, "options.sendBufferSize");
    }
    receiveBlockList = options.receiveBlockList;
    if (receiveBlockList && !isBlockList(receiveBlockList)) {
      throw $ERR_INVALID_ARG_TYPE("options.receiveBlockList", "net.BlockList", receiveBlockList);
    }
    sendBlockList = options.sendBlockList;
    if (sendBlockList && !isBlockList(sendBlockList)) {
      throw $ERR_INVALID_ARG_TYPE("options.sendBlockList", "net.BlockList", sendBlockList);
    }
  }

  const handle = newHandle(type, lookup);
  handle[kOwnerSymbol] = this;

  // this[async_id_symbol] = handle.getAsyncId();
  this.type = type;

  if (typeof listener === "function") this.on("message", listener);

  this[kStateSymbol] = {
    handle,
    receiving: false,
    bindState: BIND_STATE_UNBOUND,
    connectState: CONNECT_STATE_DISCONNECTED,
    queue: undefined,
    reuseAddr: options && options.reuseAddr,
    reusePort: options && options.reusePort,
    ipv6Only: options && options.ipv6Only,
    recvBufferSize,
    sendBufferSize,
    receiveBlockList,
    sendBlockList,
    unrefOnBind: false,
    sharedHandle: undefined,
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
$toClass(Socket, "Socket", EventEmitter);

function createSocket(type, listener) {
  return new Socket(type, listener);
}

const bufferSizeFn = $newRustFunction("udp_socket.rs", "UDPSocket.jsBufferSize", 2);

function bufferSize(self, size, buffer) {
  if (size >>> 0 !== size) throw $ERR_SOCKET_BAD_BUFFER_SIZE();

  const syscall = `uv_${buffer === RECV_BUFFER ? "recv" : "send"}_buffer_size`;

  // The handle takes the size as a C int, so anything past INT32_MAX is
  // rejected by libuv with EINVAL before it reaches the kernel.
  if (size > 0x7fffffff) {
    throw new ERR_SOCKET_BUFFER_SIZE({
      errno: UV_EINVAL,
      code: "EINVAL",
      message: kUvErrors.EINVAL[1],
      syscall,
    });
  }

  const socket = self[kStateSymbol].handle?.socket;
  if (!socket) {
    // Node reports the libuv failure from the unbound handle's missing fd.
    const code = process.platform === "win32" ? "ENOTSOCK" : "EBADF";
    throw new ERR_SOCKET_BUFFER_SIZE({
      errno: process.platform === "win32" ? kUvErrors[code][0] : UV_EBADF,
      code,
      message: kUvErrors[code][1],
      syscall,
    });
  }

  try {
    return bufferSizeFn.$call(socket, size, buffer === RECV_BUFFER);
  } catch (err) {
    const known = kUvErrors[err.code];
    throw new ERR_SOCKET_BUFFER_SIZE({
      // err.errno is only libuv-semantic on POSIX; on Windows it is Bun's
      // own negated discriminant, so re-derive from the code string.
      errno: process.platform === "win32" && known ? known[0] : err.errno,
      code: err.code,
      message: known ? known[1] : err.code,
      syscall,
    });
  }
}

Socket.prototype.bind = function (port_, address_ /* , callback */) {
  let port = port_;

  healthCheck(this);
  const state = this[kStateSymbol];

  if (state.bindState !== BIND_STATE_UNBOUND) {
    throw $ERR_SOCKET_ALREADY_BOUND();
  }

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
  const fd = port !== null && typeof port === "object" ? port.fd : undefined;
  if (isInt32(fd) && fd > 0) {
    const exclusive = !!port.exclusive;
    // In a worker the fd number refers to the primary's descriptor space
    // (Node's test-cluster-dgram-bind-fd sends a number over IPC), so route
    // through the primary before touching it locally.
    if (lazyLoadCluster().isWorker && !exclusive) {
      bindServerHandle(this, { address: null, port: null, addressType: this.type, fd, flags: null }, err => {
        state.bindState = BIND_STATE_UNBOUND;
        this.emit("error", new ErrnoException(err, "open"));
      });
      return this;
    }
    const type = guessHandleType(fd);
    if (type !== "UDP") {
      throw $ERR_INVALID_FD_TYPE(type);
    }
    // Query the native registry so bind({ fd }) throws synchronously like
    // uv_udp_open (startBunSocket routes the same failure to emit('error')).
    if (isFdAdoptedFn(fd)) {
      throw new ErrnoException(UV_EEXIST, "open");
    }
    startBunSocket(this, state, { fd });
    return this;
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

    let flags = uSockets.LISTEN_DISALLOW_REUSE_PORT_FAILURE;

    if (state.reuseAddr) {
      flags |= uSockets.LISTEN_REUSE_ADDR;
    }

    if (state.ipv6Only) {
      flags |= uSockets.SOCKET_IPV6_ONLY;
    }

    if (state.reusePort) {
      // SO_REUSEPORT load-balances in the kernel; treat it as exclusive like
      // Node so the cluster does not also share one descriptor.
      exclusive = true;
      flags |= uSockets.LISTEN_REUSE_PORT;
    }

    if (lazyLoadCluster().isWorker && !exclusive) {
      // Non-exclusive binds in a cluster worker go through the primary, which
      // creates (or reuses) one shared descriptor per address/port.
      bindServerHandle(
        this,
        {
          address: ip,
          port: port,
          addressType: this.type,
          fd: -1,
          // UV_UDP_IPV6ONLY | UV_UDP_REUSEADDR for the primary's bind of the
          // shared descriptor.
          flags: (state.ipv6Only ? 1 : 0) | (state.reuseAddr ? 4 : 0),
        },
        err => {
          const ex = new ExceptionWithHostPort(err, "bind", ip, port);
          state.bindState = BIND_STATE_UNBOUND;
          this.emit("error", ex);
        },
      );
      return;
    }

    startBunSocket(this, state, { hostname: ip, port: port || 0, flags });
  });

  return this;
};

// Asks the cluster primary for a shared descriptor and adopts it. Mirrors
// Node's bindServerHandle()/replaceHandle() pair.
function bindServerHandle(self, options, errCb) {
  const state = self[kStateSymbol];
  lazyLoadCluster()._getServer(self, options, (err, handle) => {
    if (err) {
      // Do not call the callback if the socket was closed in the mean time.
      if (state.handle) errCb(err);
      return;
    }

    if (!state.handle) {
      // Handle has been closed in the mean time.
      return handle.close();
    }

    // The shared handle from the primary never reads; adopt its descriptor
    // into a reading socket and keep the wrap so close() can notify the
    // primary. In Node the wrap *is* the socket's handle, so closing it (e.g.
    // on cluster disconnect) closes the socket — mirror that here.
    const closeWrap = handle.close;
    handle.close = function () {
      handle.close = closeWrap;
      if (state.handle) {
        // Detach first so Socket#close() doesn't re-enter this handle and
        // invoke the original close twice.
        state.sharedHandle = undefined;
        self.close();
      }
      return closeWrap.$apply(this, arguments);
    };
    state.sharedHandle = handle;
    startBunSocket(self, state, { fd: handle.fd });
  });
}

// Creates the underlying Bun.udpSocket for `self` and completes the bind:
// either from a resolved hostname/port or by adopting an existing descriptor
// (`{ fd }`). Mirrors what Node's startListening() makes observable before
// 'listening' fires.
function startBunSocket(self, state, createOptions) {
  try {
    Bun.udpSocket({
      ...createOptions,
      socket: {
        data: (_socket, data, port, address, flags) => {
          // Per-packet, from the received sockaddr's family: bind({ fd }) can
          // adopt a descriptor of the other family than `type`.
          const family = flags?.ipv6 ? "IPv6" : "IPv4";
          if (state.receiveBlockList?.check(address, flags?.ipv6 ? "ipv6" : "ipv4")) {
            return;
          }
          self.emit("message", data, {
            port: port,
            address: address,
            size: data.length,
            family,
          });
        },
        drain: () => {
          handleDrain.$call(state.handle);
        },
        error: error => {
          if (error?.syscall === "recv") {
            // Drop errqueue-origin ICMP errors on unconnected sockets like
            // Node (which never enables IP_RECVERR); always emit real
            // recvmmsg failures — the errno namespaces overlap.
            if (error.errqueue === true && state.connectState !== CONNECT_STATE_CONNECTED) {
              return;
            }
            // Node reports receive-path failures as `recvmsg` errors; keep
            // the native error so its code stays platform-correct.
            error.syscall = "recvmsg";
            error.message = `recvmsg ${error.code}`;
            self.emit("error", error);
            return;
          }
          self.emit("error", error);
        },
      },
    }).$then(
      socket => {
        if (!state.handle) {
          // Closed while the bind was in flight.
          socket.close();
          return;
        }
        if (state.unrefOnBind) {
          socket.unref();
          state.unrefOnBind = false;
        }
        state.handle.socket = socket;
        state.receiving = true;
        state.bindState = BIND_STATE_BOUND;

        // Node applies these in startListening(), before 'listening' fires.
        const { recvBufferSize, sendBufferSize } = state;
        try {
          if (recvBufferSize) bufferSize(self, recvBufferSize, RECV_BUFFER);
          if (sendBufferSize) bufferSize(self, sendBufferSize, SEND_BUFFER);
        } catch (err) {
          self.emit("error", err);
          return;
        }

        self.emit("listening");
      },
      err => {
        state.bindState = BIND_STATE_UNBOUND;
        self.emit("error", err);
      },
    );
  } catch (err) {
    state.bindState = BIND_STATE_UNBOUND;
    self.emit("error", err);
  }
}

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

  if (state.connectState !== CONNECT_STATE_DISCONNECTED) throw $ERR_SOCKET_DGRAM_IS_CONNECTED();

  state.connectState = CONNECT_STATE_CONNECTING;
  if (state.bindState === BIND_STATE_UNBOUND) this.bind({ port: 0, exclusive: true }, null);

  if (state.bindState !== BIND_STATE_BOUND) {
    enqueue(this, FunctionPrototypeBind.$call(_connect, this, port, address, callback));
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

const connectFn = $newRustFunction("udp_socket.rs", "UDPSocket.jsConnect", 2);

function doConnect(ex, self, ip, address, port, callback) {
  const state = self[kStateSymbol];
  if (!state.handle) return;

  if (!ex && state.sendBlockList?.check(ip, `ipv${isIP(ip)}`)) {
    ex = $ERR_IP_BLOCKED(ip);
  }

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

const disconnectFn = $newRustFunction("udp_socket.rs", "UDPSocket.jsDisconnect", 0);

Socket.prototype.disconnect = function () {
  const state = this[kStateSymbol];
  if (state.connectState !== CONNECT_STATE_CONNECTED) throw $ERR_SOCKET_DGRAM_NOT_CONNECTED();

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

function onListenError(_err) {
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

  healthCheck(this);

  if (state.bindState === BIND_STATE_UNBOUND) this.bind({ port: 0, exclusive: true }, null);

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

  if (ip && state.sendBlockList?.check(ip, `ipv${isIP(ip)}`)) {
    if (callback) {
      process.nextTick(callback, $ERR_IP_BLOCKED(ip));
    }
    return;
  }

  // The queued (async) path invokes req.oncomplete once the kernel accepts
  // the write; the synchronous path uses the numeric return.
  const req = { oncomplete: undefined, address, port, callback };
  let err;
  if (port) err = state.handle.send(req, list, list.length, port, ip, !!callback);
  else err = state.handle.send(req, list, list.length, !!callback);

  if (typeof err !== "number") {
    if (callback) process.nextTick(callback, decorateSendError(err, address, port));
    return;
  }

  if (err >= 1) {
    // Synchronous finish. The return code is msg_length + 1 so that we can
    // distinguish between synchronous success and asynchronous success.
    if (callback) process.nextTick(callback, null, err - 1);
    return;
  }

  if (err === 0) {
    // Queued behind kernel backpressure: completion arrives via on_drain.
    req.oncomplete = afterQueuedSend;
    return;
  }

  if (callback) {
    // Don't emit as error, dgram_legacy.js compatibility
    process.nextTick(callback, new ExceptionWithHostPort(err, "send", address, port));
  }
}

function afterQueuedSend(err, sent) {
  const callback = this.callback;
  if (!callback) return;
  if (err === undefined) {
    callback(null, sent);
  } else if (typeof err === "number") {
    callback(new ExceptionWithHostPort(err, "send", this.address, this.port));
  } else {
    callback(decorateSendError(err, this.address, this.port));
  }
}

// Native send failure: keep the original error (its code is already
// platform-correct) and decorate it like Node's ExceptionWithHostPort, which
// omits the host segment when no address/port is known.
function decorateSendError(err, address, port) {
  err.syscall = "send";
  err.address = address;
  if (port) err.port = port;
  let details = "";
  if (port && port > 0) details = ` ${address}:${port}`;
  else if (address) details = ` ${address}`;
  err.message = `send ${err.code}${details}`;
  return err;
}

Socket.prototype.close = function (callback) {
  const state = this[kStateSymbol];
  const queue = state.queue;

  if (typeof callback === "function") this.on("close", callback);

  if (queue !== undefined) {
    queue.push(FunctionPrototypeBind.$call(this.close, this));
    return this;
  }

  healthCheck(this);
  state.receiving = false;
  const handle = state.handle;
  state.handle.socket?.close();
  state.handle = null;
  // Requests still queued behind backpressure never reach the kernel once the
  // descriptor is gone. libuv reports each as ECANCELED, not EBADF
  // (uv__udp_finish_close); callbacks fire on the next tick, after close.
  if (handle.sendQueue !== undefined) {
    const queue = handle.sendQueue;
    const head = handle.sendQueueHead;
    handle.sendQueue = undefined;
    handle.sendQueueHead = 0;
    for (let i = head; i < queue.length; i++) completeQueuedSend(handle, queue[i], UV_ECANCELED);
  }
  if (state.sharedHandle) {
    // Tells the cluster primary this worker no longer uses the shared
    // descriptor (the descriptor itself was owned and closed by the socket).
    state.sharedHandle.close();
    state.sharedHandle = undefined;
  }
  defaultTriggerAsyncIdScope(this[async_id_symbol], process.nextTick, socketCloseNT, this);

  return this;
};

Socket.prototype[SymbolAsyncDispose] = async function () {
  if (!this[kStateSymbol].handle) {
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
  healthCheck(this);

  const socket = this[kStateSymbol].handle.socket;
  // Node calls getsockname() on the (lazily created, still fd-less) handle,
  // which reports EBADF until the socket is bound.
  if (!socket) throw new ErrnoException(UV_EBADF, "getsockname");
  if (process.platform === "win32") {
    // No fd registry on Windows (fd adoption isn't supported there anyway),
    // so the cached value is never stale.
    return socket.address;
  }
  // Fresh getsockname each call, like Node — the cached `.address` can be
  // stale if an adopted-but-unbound fd auto-bound on the first sendto().
  return getSockNameFn(getFdFn.$call(socket));
};

Socket.prototype.remoteAddress = function () {
  healthCheck(this);

  const state = this[kStateSymbol];
  const socket = state.handle.socket;

  if (!socket) throw $ERR_SOCKET_DGRAM_NOT_RUNNING();

  if (state.connectState !== CONNECT_STATE_CONNECTED) throw $ERR_SOCKET_DGRAM_NOT_CONNECTED();

  if (!socket.remoteAddress) throw $ERR_SOCKET_DGRAM_NOT_CONNECTED();

  return socket.remoteAddress;
};

Socket.prototype.setBroadcast = function (arg) {
  const handle = this[kStateSymbol].handle;
  if (!handle?.socket) {
    throw new ErrnoException(UV_EBADF, "setBroadcast");
  }
  return handle.socket.setBroadcast(arg);
};

Socket.prototype.setTTL = function (ttl) {
  validateNumber(ttl, "ttl");

  const handle = this[kStateSymbol].handle;
  if (!handle?.socket) {
    throw new ErrnoException(UV_EBADF, "setTTL");
  }
  try {
    handle.socket.setTTL(ttl);
  } catch (err) {
    // Reuse the native error's platform-correct code, reported the way Node's
    // ErrnoException would ("setTTL EINVAL").
    err.syscall = "setTTL";
    err.message = `setTTL ${err.code}`;
    throw err;
  }
  return ttl;
};

Socket.prototype.setMulticastTTL = function (ttl) {
  validateNumber(ttl, "ttl");

  const handle = this[kStateSymbol].handle;
  if (!handle?.socket) {
    throw new ErrnoException(UV_EBADF, "setMulticastTTL");
  }
  try {
    handle.socket.setMulticastTTL(ttl);
  } catch (err) {
    err.syscall = "setMulticastTTL";
    err.message = `setMulticastTTL ${err.code}`;
    throw err;
  }
  return ttl;
};

Socket.prototype.setMulticastLoopback = function (arg) {
  const handle = this[kStateSymbol].handle;
  if (!handle?.socket) {
    throw new ErrnoException(UV_EBADF, "setMulticastLoopback");
  }
  return handle.socket.setMulticastLoopback(arg);
};

Socket.prototype.setMulticastInterface = function (interfaceAddress) {
  validateString(interfaceAddress, "interfaceAddress");
  const handle = this[kStateSymbol].handle;
  if (!handle?.socket) {
    throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
  }
  if (!handle.socket.setMulticastInterface(interfaceAddress)) {
    throw new ErrnoException(UV_EINVAL, "setMulticastInterface");
  }
};

Socket.prototype.addMembership = function (multicastAddress, interfaceAddress) {
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
      throw new ErrnoException(UV_EINVAL, "addMembership");
    }
    throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
  }
  if (bindState === BIND_STATE_UNBOUND) {
    this.bind({ port: 0, exclusive: true }, null);
  }
  return handle.socket.addMembership(multicastAddress, interfaceAddress);
};

Socket.prototype.dropMembership = function (multicastAddress, interfaceAddress) {
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
      throw new ErrnoException(UV_EINVAL, "dropMembership");
    }
    throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
  }
  return handle.socket.dropMembership(multicastAddress, interfaceAddress);
};

Socket.prototype.addSourceSpecificMembership = function (sourceAddress, groupAddress, interfaceAddress) {
  validateString(sourceAddress, "sourceAddress");
  validateString(groupAddress, "groupAddress");
  if (typeof interfaceAddress !== "undefined") {
    validateString(interfaceAddress, "interfaceAddress");
  }

  const { handle, bindState } = this[kStateSymbol];
  if (!handle?.socket) {
    if (!isIP(sourceAddress) || !isIP(groupAddress)) {
      throw new ErrnoException(UV_EINVAL, "addSourceSpecificMembership");
    }
    throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
  }
  if (bindState === BIND_STATE_UNBOUND) {
    this.bind(0);
  }
  return handle.socket.addSourceSpecificMembership(sourceAddress, groupAddress, interfaceAddress);
};

Socket.prototype.dropSourceSpecificMembership = function (sourceAddress, groupAddress, interfaceAddress) {
  validateString(sourceAddress, "sourceAddress");
  validateString(groupAddress, "groupAddress");
  if (typeof interfaceAddress !== "undefined") {
    validateString(interfaceAddress, "interfaceAddress");
  }

  const { handle, bindState } = this[kStateSymbol];
  if (!handle?.socket) {
    if (!isIP(sourceAddress) || !isIP(groupAddress)) {
      throw new ErrnoException(UV_EINVAL, "dropSourceSpecificMembership");
    }
    throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
  }
  if (bindState === BIND_STATE_UNBOUND) {
    this.bind(0);
  }
  return handle.socket.dropSourceSpecificMembership(sourceAddress, groupAddress, interfaceAddress);
};

Socket.prototype.ref = function () {
  const socket = this[kStateSymbol].handle?.socket;

  if (socket) socket.ref();
  // The last ref()/unref() before bind wins, like Node's always-present handle.
  else this[kStateSymbol].unrefOnBind = false;

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
  return this[kStateSymbol].handle.getSendQueueSize();
};

Socket.prototype.getSendQueueCount = function () {
  return this[kStateSymbol].handle.getSendQueueCount();
};

// Deprecated private APIs.
ObjectDefineProperty(Socket.prototype, "_handle", {
  get: deprecate(
    function () {
      return this[kStateSymbol].handle;
    },
    "Socket.prototype._handle is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (val) {
      this[kStateSymbol].handle = val;
    },
    "Socket.prototype._handle is deprecated",
    "DEP0112",
  ),
});

ObjectDefineProperty(Socket.prototype, "_receiving", {
  get: deprecate(
    function () {
      return this[kStateSymbol].receiving;
    },
    "Socket.prototype._receiving is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (val) {
      this[kStateSymbol].receiving = val;
    },
    "Socket.prototype._receiving is deprecated",
    "DEP0112",
  ),
});

ObjectDefineProperty(Socket.prototype, "_bindState", {
  get: deprecate(
    function () {
      return this[kStateSymbol].bindState;
    },
    "Socket.prototype._bindState is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (val) {
      this[kStateSymbol].bindState = val;
    },
    "Socket.prototype._bindState is deprecated",
    "DEP0112",
  ),
});

ObjectDefineProperty(Socket.prototype, "_queue", {
  get: deprecate(
    function () {
      return this[kStateSymbol].queue;
    },
    "Socket.prototype._queue is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (val) {
      this[kStateSymbol].queue = val;
    },
    "Socket.prototype._queue is deprecated",
    "DEP0112",
  ),
});

ObjectDefineProperty(Socket.prototype, "_reuseAddr", {
  get: deprecate(
    function () {
      return this[kStateSymbol].reuseAddr;
    },
    "Socket.prototype._reuseAddr is deprecated",
    "DEP0112",
  ),
  set: deprecate(
    function (val) {
      this[kStateSymbol].reuseAddr = val;
    },
    "Socket.prototype._reuseAddr is deprecated",
    "DEP0112",
  ),
});

function healthCheck(socket) {
  if (!socket[kStateSymbol].handle) {
    throw $ERR_SOCKET_DGRAM_NOT_RUNNING();
  }
}

Socket.prototype._healthCheck = deprecate(
  function () {
    healthCheck(this);
  },
  "Socket.prototype._healthCheck() is deprecated",
  "DEP0112",
);

function stopReceiving(socket) {
  const state = socket[kStateSymbol];

  if (!state.receiving) return;

  // state.handle.recvStop();
  state.receiving = false;
}

Socket.prototype._stopReceiving = deprecate(
  function () {
    stopReceiving(this);
  },
  "Socket.prototype._stopReceiving() is deprecated",
  "DEP0112",
);

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
