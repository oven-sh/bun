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

// IPv4 Segment
const v4Seg = "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
const v4Str = `(${v4Seg}[.]){3}${v4Seg}`;
const IPv4Reg = new RegExp(`^${v4Str}$`);

// IPv6 Segment
const v6Seg = "(?:[0-9a-fA-F]{1,4})";
const IPv6Reg = new RegExp(
  "^(" +
    `(?:${v6Seg}:){7}(?:${v6Seg}|:)|` +
    `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|` +
    `(?:${v6Seg}:){5}(?::${v4Str}|(:${v6Seg}){1,2}|:)|` +
    `(?:${v6Seg}:){4}(?:(:${v6Seg}){0,1}:${v4Str}|(:${v6Seg}){1,3}|:)|` +
    `(?:${v6Seg}:){3}(?:(:${v6Seg}){0,2}:${v4Str}|(:${v6Seg}){1,4}|:)|` +
    `(?:${v6Seg}:){2}(?:(:${v6Seg}){0,3}:${v4Str}|(:${v6Seg}){1,5}|:)|` +
    `(?:${v6Seg}:){1}(?:(:${v6Seg}){0,4}:${v4Str}|(:${v6Seg}){1,6}|:)|` +
    `(?::((?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))` +
    ")(%[0-9a-zA-Z-.:]{1,})?$",
);

export function isIPv4(s) {
  return IPv4Reg.test(s);
}

export function isIPv6(s) {
  return IPv6Reg.test(s);
}

export function isIP(s) {
  if (isIPv4(s)) return 4;
  if (isIPv6(s)) return 6;
  return 0;
}

const { Bun, createFIFO, Object } = import.meta.primordials;
const { connect: bunConnect } = Bun;
const { Duplex } = import.meta.require("node:stream");
const { EventEmitter } = import.meta.require("node:events");

const bunTlsSymbol = Symbol.for("::buntls::");
var SocketClass;
export const Socket = (function (InternalSocket) {
  SocketClass = InternalSocket;
  Object.defineProperty(SocketClass.prototype, Symbol.toStringTag, {
    value: "Socket",
    enumerable: false,
  });

  return Object.defineProperty(
    function Socket(options) {
      return new InternalSocket(options);
    },
    Symbol.hasInstance,
    {
      value(instance) {
        return instance instanceof InternalSocket;
      },
    },
  );
})(
  class Socket extends Duplex {
    static _Handlers = {
      close({ data: self }) {
        Socket.#Close(self);
        self.emit("close");
      },
      connectError(socket, error) {
        const self = socket.data;
        self.emit("error", error);
      },
      data({ data: self }, buffer) {
        self.bytesRead += buffer.length;
        const queue = self.#readQueue;

        if (queue.isEmpty()) {
          if (self.push(buffer)) return;
        }
        queue.push(buffer);
      },
      drain: Socket.#Drain,
      end({ data: self }) {
        Socket.#Close(self);
        self.emit("end");
      },
      error(socket, error) {
        const self = socket.data;
        const callback = self.#writeCallback;
        if (callback) {
          self.#writeCallback = null;
          callback(error);
        }
        console.error(error);
        self.emit("error", error);
      },
      serverOpen(socket) {
        const self = socket.data;
        socket.timeout(self.timeout);
        socket.ref();
        self.#socket = socket;
        self.connecting = false;
        self.emit("connect");
        Socket.#Drain(socket);
      },
      open(socket) {
        const self = socket.data;
        socket.timeout(self.timeout);
        socket.ref();
        self.#socket = socket;
        self.connecting = false;
        self.emit("connect");
        Socket.#Drain(socket);
      },
      timeout(socket) {
        const self = socket.data;
        self.emit("timeout");
      },
      binaryType: "buffer",
    };

    static #Close(self) {
      if (self.#closed) return;
      self.#closed = true;
      const queue = self.#readQueue;
      if (queue.isEmpty()) {
        if (self.push(null)) return;
      }
      queue.push(null);
    }

    static #Drain(socket) {
      const self = socket.data;
      const callback = self.#writeCallback;
      if (callback) {
        const chunk = self.#writeChunk;
        const written = socket.write(chunk);

        self.bytesWritten += written;
        if (written < chunk.length) {
          self.#writeChunk = chunk.slice(written);
        } else {
          self.#writeCallback = null;
          self.#writeChunk = null;
          callback(null);
        }
      }
    }

    bytesRead = 0;
    bytesWritten = 0;
    #closed = false;
    connecting = false;
    localAddress = "127.0.0.1";
    #readQueue = createFIFO();
    remotePort;
    #socket;
    timeout = 0;
    #writeCallback;
    #writeChunk;
    #pendingRead;

    constructor(options) {
      const { signal, write, read, allowHalfOpen = false, ...opts } = options || {};
      super({
        ...opts,
        allowHalfOpen,
        readable: true,
        writable: true,
      });
      this.#pendingRead = undefined;
      signal?.once("abort", () => this.destroy());
      this.once("connect", () => this.emit("ready"));
    }

    address() {
      return {
        address: this.localAddress,
        family: this.localFamily,
        port: this.localPort,
      };
    }

    get bufferSize() {
      return this.writableLength;
    }

    _attach(port, socket) {
      this.remotePort = port;
      socket.data = this;
      socket.timeout(this.timeout);
      socket.ref();
      this.#socket = socket;
      this.connecting = false;
      this.emit("connect");
      Socket.#Drain(socket);
    }

    connect(port, host, connectListener) {
      // TODO support IPC sockets
      var path;
      if (arguments.length === 1 && typeof port === "string") {
        path = port;
        port = undefined;
      } else if (typeof host == "function") {
        if (typeof port === "string") {
          path = port;
          port = undefined;
        }

        connectListener = host;
        host = undefined;
      }
      if (typeof port == "object") {
        var {
          port,
          host,
          // TODOs
          localAddress,
          localPort,
          family,
          hints,
          lookup,
          noDelay,
          keepAlive,
          keepAliveInitialDelay,
        } = port;
      }
      this.connecting = true;
      this.remotePort = port;
      if (connectListener) this.on("connect", connectListener);
      const bunTLS = this[bunTlsSymbol];
      var tls = undefined;
      if (typeof bunTLS === "function") {
        tls = bunTLS.call(this, port, host);
      }
      bunConnect(
        path
          ? {
              data: this,
              unix: path,
              socket: Socket._Handlers,
              tls,
            }
          : {
              data: this,
              hostname: host || "localhost",
              port: port,
              socket: Socket._Handlers,
              tls,
            },
      );
      return this;
    }

    _destroy(err, callback) {
      this.#socket?.end();
      callback(err);
    }

    _final(callback) {
      this.#socket.end();
      callback();
    }

    get localAddress() {
      return "127.0.0.1";
    }

    get localFamily() {
      return "IPv4";
    }

    get localPort() {
      return this.#socket?.localPort;
    }

    get pending() {
      return this.connecting;
    }

    _read(size) {
      const queue = this.#readQueue;
      let chunk;
      while ((chunk = queue.peek())) {
        if (!this.push(chunk)) return;
        queue.shift();
      }
    }

    get readyState() {
      if (this.connecting) return "opening";
      if (this.readable) {
        return this.writable ? "open" : "readOnly";
      } else {
        return this.writable ? "writeOnly" : "closed";
      }
    }

    ref() {
      this.#socket?.ref();
    }

    get remoteAddress() {
      return this.#socket.remoteAddress;
    }

    get remoteFamily() {
      return "IPv4";
    }

    resetAndDestroy() {
      this.#socket?.end();
    }

    pause() {
      //TODO
      return this;
    }

    resume() {
      //TODO
      return this;
    }

    setKeepAlive(enable = false, initialDelay = 0) {
      // TODO
      return this;
    }

    setNoDelay(noDelay = true) {
      // TODO
      return this;
    }

    setTimeout(timeout, callback) {
      this.#socket?.timeout(timeout);
      this.timeout = timeout;
      if (callback) this.once("timeout", callback);
      return this;
    }

    unref() {
      this.#socket?.unref();
    }

    _write(chunk, encoding, callback) {
      if (typeof chunk == "string" && encoding !== "utf8") chunk = Buffer.from(chunk, encoding);
      var written = this.#socket?.write(chunk);
      if (written == chunk.length) {
        callback();
      } else if (this.#writeCallback) {
        callback(new Error("overlapping _write()"));
      } else {
        if (written > 0) {
          if (typeof chunk == "string") {
            chunk = chunk.slice(written);
          } else {
            chunk = chunk.subarray(written);
          }
        }

        this.#writeCallback = callback;
        this.#writeChunk = chunk;
      }
    }
  },
);

export function createConnection(port, host, connectListener) {
  if (typeof host == "function") {
    connectListener = host;
    host = undefined;
  }
  var options =
    typeof port == "object"
      ? port
      : {
          host: host,
          port: port,
        };
  return new Socket(options).connect(options, connectListener);
}

export const connect = createConnection;

class Server extends EventEmitter {
  #connectionListener;
  #options;
  #server;
  #listening;
  #connections;

  constructor(options, connectionListener) {
    super();
    this.maxConnections = 0;

    if (typeof options === "function") {
      connectionListener = options;
      options = {};
    } else if (options == null || typeof options === "object") {
      options = { ...options };
    } else {
      throw new Error("bun-net-polyfill: invalid arguments");
    }

    if (typeof options.maxConnections === "number" && options.maxConnections > 0) {
      this.maxConnections = options.maxConnections;
    }

    this.#listening = false;
    this.#connections = 0;
    this.#connectionListener = connectionListener;
    this.#options = options;
  }

  ref() {
    this.#server?.ref();
    return this;
  }

  unref() {
    this.#server?.unref();
    return this;
  }

  close(callback) {
    if (this.#server) {
      this.#server.stop(true);
      this.#server = null;
      this.#listening = false;
      this.#connections = 0;
      this.emit("close");
      if (typeof callback === "function") {
        callback();
      }

      return this;
    }

    if (typeof callback === "function") {
      callback(new Error("Server is not open"));
    }
    return this;
  }

  address() {
    if (this.#server) {
      //TODO: fix adress when host is passed
      let address = this.#server.hostname;
      const type = isIP(address);
      const port = this.#server.port;
      if (typeof port === "number") {
        return {
          port,
          address,
          family: type ? `IPv${type}` : undefined,
        };
      }

      if (type) {
        return {
          address,
          family: type ? `IPv${type}` : undefined,
        };
      }

      return address;
    }
    return null;
  }

  getConnections(callback) {
    if (typeof callback === "function") {
      callback(this.#server ? null : new Error("Server is not open"), this.#connections);
    }
    return this;
  }

  listen(port, hostname, onListen) {
    if (typeof hostname === "function") {
      onListen = hostname;
      hostname = undefined;
    }

    if (typeof port === "function") {
      onListen = port;
      port = 0;
    } else if (typeof port === "object") {
      port?.signal?.addEventListener("abort", () => this.close());

      hostname = port?.host;
      port = port?.port || 0;

      // port <number>
      // host <string>
      // path <string> Will be ignored if port is specified. See Identifying paths for IPC connections.
      // backlog <number> Common parameter of server.listen() functions.
      // exclusive <boolean> Default: false
      // readableAll <boolean> For IPC servers makes the pipe readable for all users. Default: false.
      // writableAll <boolean> For IPC servers makes the pipe writable for all users. Default: false.
      // ipv6Only <boolean> For TCP servers, setting ipv6Only to true will disable dual-stack support, i.e., binding to host :: won't make 0.0.0.0 be bound. Default: false.
      // signal <AbortSignal> An AbortSignal that may be used to close a listening server.

      if (typeof port?.callback === "function") onListen = port?.callback;
    }
    if (typeof port !== "number") {
      port = 0;
    }

    hostname = hostname || "::";
    const connectionListener = this.#connectionListener;
    const { pauseOnConnect } = this.#options;
    const self = this;
    try {
      this.#server = Bun.listen({
        port,
        hostname,
        tls: false,
        socket: {
          data({ data: self }, buffer) {
            self.bytesRead += buffer.length;
            self.emit("data", buffer);
          },
          close(socket) {
            SocketClass._Handlers.close(socket);
            self.#connections--;
          },
          end(socket) {
            SocketClass._Handlers.end(socket);
            self.#connections--;
          },
          open(socket) {
            const _socket = new SocketClass(self.#options);
            _socket._attach(self.#server?.port, socket);
            if (self.maxConnections && self.#connections >= self.maxConnections) {
              const data = {
                localAddress: _socket.localAddress,
                localPort: _socket.localPort,
                localFamily: _socket.localFamily,
                remoteAddress: _socket.remoteAddress,
                remotePort: _socket.remotePort,
                remoteFamily: _socket.remoteFamily,
              };
              socket.end();
              self.emit("drop", data);
              return;
            }
            if (pauseOnConnect) {
              _socket.pause();
            }
            self.#connections++;
            if (typeof connectionListener == "function") {
              connectionListener(_socket);
            }
            self.emit("connection", _socket);
          },
          error(socket, error) {
            SocketClass._Handlers.error(socket, error);
            self.emit("error", error);
          },
          timeout: SocketClass._Handlers.timeuout,
          connectError: SocketClass._Handlers.connectError,
          drain: SocketClass._Handlers.drain,
          binaryType: "buffer",
        },
      });
      if (typeof onListen === "function") {
        onListen();
      }
      this.#listening = true;
      self.emit("listening");
    } catch (err) {
      this.#listening = false;
      self.emit("error", err);
    }
    return this;
  }
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}

export default {
  createServer,
  Server,
  createConnection,
  connect,
  isIP,
  isIPv4,
  isIPv6,
  Socket,
  [Symbol.for("CommonJS")]: 0,
  [Symbol.for("::bunternal::")]: SocketClass,
};
