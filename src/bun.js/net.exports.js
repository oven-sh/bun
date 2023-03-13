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
const bunSocketServerHandlers = Symbol.for("::bunsocket_serverhandlers::");
const bunSocketServerConnections = Symbol.for("::bunnetserverconnections::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");

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
    static #Handlers = {
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
      self.unref();
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

    static [bunSocketServerHandlers] = {
      data: Socket.#Handlers.data,
      close(socket) {
        Socket.#Handlers.close(socket);
        this.data[bunSocketServerConnections]--;
      },
      end(socket) {
        Socket.#Handlers.end(socket);
        this.data[bunSocketServerConnections]--;
      },
      open(socket) {
        const self = this.data;
        const options = self[bunSocketServerOptions];
        const { pauseOnConnect, connectionListener, InternalSocketClass } = options;
        const _socket = new InternalSocketClass(options);
        _socket.#attach(this.localPort, socket);
        if (self.maxConnections && self[bunSocketServerConnections] >= self.maxConnections) {
          const data = {
            localAddress: _socket.localAddress,
            localPort: _socket.localPort,
            localFamily: _socket.localFamily,
            remoteAddress: _socket.remoteAddress,
            remotePort: _socket.remotePort,
            remoteFamily: _socket.remoteFamily || "IPv4",
          };
          socket.end();

          self.emit("drop", data);
          return;
        }
        // the duplex implementation start paused, so we resume when pauseOnConnect is falsy
        if (!pauseOnConnect) {
          _socket.resume();
        }

        self[bunSocketServerConnections]++;
        if (typeof connectionListener == "function") {
          connectionListener(_socket);
        }
        self.emit("connection", _socket);
      },
      error(socket, error) {
        Socket.#Handlers.error(socket, error);
        this.data.emit("error", error);
      },
      timeout: Socket.#Handlers.timeout,
      connectError: Socket.#Handlers.connectError,
      drain: Socket.#Handlers.drain,
      binaryType: "buffer",
    };

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

    #attach(port, socket) {
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
      var path;
      if (typeof port === "string") {
        path = port;
        port = undefined;

        if (typeof host === "function") {
          connectListener = host;
          host = undefined;
        }
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
      return this.#socket?.remoteAddress;
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
  #server;
  #listening = false;
  [bunSocketServerConnections] = 0;
  [bunSocketServerOptions];
  maxConnections = 0;

  constructor(options, connectionListener) {
    super();

    if (typeof options === "function") {
      connectionListener = options;
      options = {};
    } else if (options == null || typeof options === "object") {
      options = { ...options };
    } else {
      throw new Error("bun-net-polyfill: invalid arguments");
    }

    const { maxConnections } = options;
    this.maxConnections = Number.isSafeInteger(maxConnections) && maxConnections > 0 ? maxConnections : 0;

    options.connectionListener = connectionListener;
    this[bunSocketServerOptions] = options;
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
      this[bunSocketServerConnections] = 0;
      this.emit("close");
      if (typeof callback === "function") {
        callback();
      }

      return this;
    }

    if (typeof callback === "function") {
      const error = new Error("Server is not running");
      error.code = "ERR_SERVER_NOT_RUNNING";
      callback(error);
    }
    return this;
  }

  address() {
    const server = this.#server;
    if (server) {
      const unix = server.unix;
      if (unix) {
        return unix;
      }

      //TODO: fix adress when host is passed
      let address = server.hostname;
      const type = isIP(address);
      const port = server.port;
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
      //in Bun case we will never error on getConnections
      //node only errors if in the middle of the couting the server got disconnected, what never happens in Bun
      //if disconnected will only pass null as well and 0 connected
      callback(null, this.#server ? this[bunSocketServerConnections] : 0);
    }
    return this;
  }

  listen(port, hostname, onListen) {
    let backlog;
    let path;
    //port is actually path
    if (typeof port === "string") {
      if (Number.isSafeInteger(hostname)) {
        if (hostname > 0) {
          //hostname is backlog
          backlog = hostname;
        }
      } else if (typeof hostname === "function") {
        //hostname is callback
        onListen = hostname;
      }

      path = port;
      hostname = undefined;
      port = undefined;
    } else {
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

        port = port?.port;
        const path = port?.path;
        if (!port && path) {
          hostname = path;
          port = undefined;
        } else if (!Number.isSafeInteger(port) || port < 0) {
          port = 0;
        }
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
      } else if (!Number.isSafeInteger(port) || port < 0) {
        port = 0;
      }
      hostname = hostname || "::";
    }

    try {
      var tls = undefined;
      var TLSSocketClass = undefined;
      const bunTLS = this[bunTlsSymbol];
      if (typeof bunTLS === "function") {
        [tls, TLSSocketClass] = bunTLS.call(this, port, hostname);
      }

      this[bunSocketServerOptions].InternalSocketClass = TLSSocketClass || SocketClass;

      this.#server = Bun.listen(
        path
          ? {
              unix: path,
              tls,
              socket: SocketClass[bunSocketServerHandlers],
            }
          : {
              port,
              hostname,
              tls,
              socket: SocketClass[bunSocketServerHandlers],
            },
      );

      //make this instance available on handlers
      this.#server.data = this;

      if (typeof onListen === "function") {
        onListen();
      }
      this.#listening = true;
      this.emit("listening");
    } catch (err) {
      this.#listening = false;
      this.emit("error", err);
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
