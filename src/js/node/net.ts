// Hardcoded module "node:net"
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
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
import { Duplex, type DuplexOptions } from "node:stream";
import EventEmitter from "node:events";
const {
  SocketAddress,
  addServerName,
  upgradeDuplexToTLS,
  isNamedPipeSocket,
  normalizedArgsSymbol,
  getBufferedAmount,
} = require("internal/net");
const { ExceptionWithHostPort } = require("internal/shared") as {
  ExceptionWithHostPort: new (errno: number | string, syscall: string, address: string, port: number) => Error;
};
const { ErrnoException } = require("internal/errors") as {
  ErrnoException: new (code: number, syscall: string) => NodeJS.ErrnoException;
  aggregateTwoErrors: (...args: any[]) => Error;
};
import type {
  SocketListener,
  SocketHandler as BunSocketHandler, // Renamed to avoid conflict
  TCPSocket as BunTCPSocket, // Renamed
  UnixSocketListener,
  TCPSocketListener,
  UnixSocketOptions as BunUnixSocketOptions, // Renamed
  TCPSocketListenOptions as BunTCPSocketListenOptions, // Renamed
  TCPSocketConnectOptions as BunTCPSocketConnectOptions, // Renamed
  TLSSocket as BunTLSSocket, // Renamed
} from "bun";
import type { ServerOpts as BunServerOpts, SocketConstructorOpts as BunSocketConstructorOpts } from "node:net";
const { getTimerDuration } = require("internal/timers");
const { validateFunction, validateNumber, validateAbortSignal } = require("internal/validators");
import type * as stream from "node:stream";
import type * as NodeCluster from "node:cluster";
import type { AddressInfo } from "node:net";
import type * as utilInspect from "node-inspect-extracted"; // For custom inspect

// Define internal properties for Socket
// Use any for Data where type conflicts arise between Server and client Socket data

// Define a type for the underlying Bun socket handle
type BunSocketHandle = $ZigGeneratedClasses.TCPSocket | $ZigGeneratedClasses.TLSSocket;

// Define a type for the SocketHandler using the Bun socket handle type and requiring buffer binary type
// IMPORTANT: Node.js stream/socket patterns typically pass the wrapper object (Socket<Data>)
// to handlers, not the raw underlying handle.
type NodeSocketHandler<Data> = {
  open?(socket: Socket<Data>): void | Promise<void>;
  data?(socket: Socket<Data>, data: Buffer): void | Promise<void>;
  close?(socket: Socket<Data>, error?: Error): void | Promise<void>; // Node's close often takes an optional error
  drain?(socket: Socket<Data>): void | Promise<void>;
  error?(socket: Socket<Data>, error: Error): void | Promise<void>;
  end?(socket: Socket<Data>): void | Promise<void>;
  handshake?(socket: Socket<Data>, success: boolean, authorizationError: Error | null): void;
  timeout?(socket: Socket<Data>): void | Promise<void>;
};


const kpendingRead = Symbol("kpendingRead");
const kupgraded = Symbol("kupgraded");
const kSetNoDelay = Symbol("kSetNoDelay");
const kSetKeepAlive = Symbol("kSetKeepAlive");
const kSetKeepAliveInitialDelay = Symbol("kSetKeepAliveInitialDelay");
const khandlers = Symbol("khandlers");
const kBytesWritten = Symbol("kBytesWritten");
const kclosed = Symbol("closed");
const kended = Symbol("ended");
const kwriteCallback = Symbol("writeCallback");
const ksocket = Symbol("ksocket");
const kConnectOptions = Symbol("connect-options");
const kAttach = Symbol("kAttach");
const kCloseRawConnection = Symbol("kCloseRawConnection");
const kSocketClass = Symbol("kSocketClass");

// Use unique symbols for internal properties used as computed keys
const bunTlsSymbol = Symbol("::buntls::");
const bunSocketServerConnections = Symbol("::bunnetserverconnections::");
const bunSocketServerOptions = Symbol("::bunnetserveroptions::");
const kServerSocket = Symbol("kServerSocket");
const bunTLSConnectOptions = Symbol("::buntlsconnectoptions::");
const kRealListen = Symbol("kRealListen");
const nodejsUtilInspectCustom = Symbol.for("nodejs.util.inspect.custom");

interface Socket<Data = any> extends stream.Duplex {
  [kpendingRead]: undefined | (() => void);
  [kupgraded]: Socket | null;
  [kSetNoDelay]: boolean;
  [kSetKeepAlive]: boolean;
  [kSetKeepAliveInitialDelay]: number;
  [khandlers]: NodeSocketHandler<Data>;
  bytesRead: number;
  [kBytesWritten]: number | undefined;
  [kclosed]: boolean;
  [kended]: boolean;
  connecting: boolean;
  localAddress: string;
  localPort?: number;
  // localFamily?: string; // Defined below by getter
  remoteAddress?: string;
  remotePort: number | undefined;
  remoteFamily?: string;
  [bunTLSConnectOptions]: any | null;
  timeout: number;
  [kwriteCallback]: ((err?: Error | null) => void) | undefined;
  _pendingData: Buffer | string | WriteVDataObject | null | undefined;
  _pendingEncoding: BufferEncoding | undefined;
  _hadError: boolean;
  isServer: boolean;
  _handle: BunSocketHandle | null; // Use BunSocketHandle type
  _parent: any;
  _parentWrap: any;
  [ksocket]: Socket<any> | undefined; // Allow Socket<any>
  server: Server | undefined;
  pauseOnConnect: boolean;
  [kConnectOptions]: any;
  servername?: string | false | undefined; // Allow false and undefined
  _requestCert?: boolean;
  _rejectUnauthorized: boolean; // Must be boolean
  authorized?: boolean;
  authorizationError?: string | Error | null; // Allow null
  secureConnecting?: boolean;
  _secureEstablished?: boolean;
  _securePending?: boolean;
  alpnProtocol?: string | false | null; // Allow null
  [bunTlsSymbol]?: (port: number | undefined, host: string | undefined, isClient: boolean) => any;
  _undestroy(): void;
  _emitTLSError(error: Error): void;
  setSession(session: Buffer): void;
  getPeerCertificate(detailed?: boolean): any;
  resetAndClosing?: boolean;
  _reset(err?: Error): this; // Allow optional error argument

  // Duplex properties (ensure they are accessible)
  allowHalfOpen: boolean;
  destroyed: boolean;
  writable: boolean;
  readable: boolean;
  writableEnded: boolean;
  writableFinished: boolean;
  writableLength: number;
  writableBuffer: Array<{ chunk: any; encoding: BufferEncoding }>;
  _readableState: any; // Simplified type for internal state
  _writableState: any; // Simplified type for internal state

  // Methods from Duplex/EventEmitter
  address(): { port: number; family: string; address: string } | null;
  _onTimeout(): void;
  bufferSize: number;
  _bytesDispatched: number;
  bytesWritten: number;
  [kAttach](port: number | undefined, socket: BunSocketHandle): void; // Use BunSocketHandle type, allow undefined port
  [kCloseRawConnection](): void;
  connect(...args: any[]): this;
  // end(...args: any[]): this; // Inherited from Duplex
  _destroy(err: Error | null, callback: (error?: Error | null) => void): void;
  _final(callback: (error?: Error | null) => void): void;
  readonly localFamily: string;
  _connecting: boolean;
  pending: boolean;
  resume(): this;
  pause(): this;
  read(size?: number): any;
  _read(size: number): void;
  readyState: "opening" | "open" | "readOnly" | "writeOnly" | "closed";
  ref(): this;
  resetAndDestroy(): this;
  setKeepAlive(enable?: boolean, initialDelay?: number): this;
  setNoDelay(enable?: boolean): this;
  setTimeout(timeout: number, callback?: () => void): this;
  _unrefTimer(): void;
  unref(): this;
  destroySoon(): void;
  _writev?(data: WriteVDataObject, callback: (error?: Error | null) => void): void;
  _write(chunk: any, encoding: BufferEncoding | undefined, callback: (error?: Error | null) => void): void;

  // EventEmitter methods
  emit(eventName: string | symbol, ...args: any[]): boolean;
  on(eventName: string | symbol, listener: (...args: any[]) => void): this;
  once(eventName: string | symbol, listener: (...args: any[]) => void): this;
  prependListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
  removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
  off(eventName: string | symbol, listener: (...args: any[]) => void): this;
  push(chunk: any, encoding?: BufferEncoding): boolean;
  destroy(error?: Error): this;

  // Explicit overloads for write to match Duplex
  write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean;
  write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean;

  // Custom inspect symbol
  [nodejsUtilInspectCustom]?(depth: number, options: utilInspect.InspectOptionsStylized): string;

  // TLS specific properties (added for compatibility with TLSSocket)
  getX509Certificate?(): any;
  getPeerX509Certificate?(): any;
  isSessionReused?(): boolean;
}

// Augment ServerOpts from node:net to include Bun/internal properties
interface ServerOpts extends BunServerOpts {
  exclusive?: boolean;
  ipv6Only?: boolean;
  reusePort?: boolean;
  backlog?: number;
  readableAll?: boolean; // Used internally?
  writableAll?: boolean; // Used internally?
  requestCert?: boolean;
  rejectUnauthorized?: boolean;
  [kSocketClass]?: new (opts?: SocketConstructorOpts) => Socket<any>; // Use any for Socket data
  servername?: string | undefined; // Allow undefined
  signal?: AbortSignal;
  callback?: (...args: any[]) => void; // Used internally?
  port?: number;
  path?: string;
  host?: string;
  maxConnections?: number;
  connectionListener?: (this: Server, socket: Socket<any>) => void; // Use any for Socket data, add this type
}

// Augment SocketConstructorOpts from node:net
// Avoid extending BunSocketConstructorOpts directly if it causes conflicts
interface SocketConstructorOpts extends Omit<BunSocketConstructorOpts, "onread"> {
  objectMode?: boolean;
  readableObjectMode?: boolean;
  writableObjectMode?: boolean;
  keepAlive?: boolean;
  keepAliveInitialDelay?: number;
  noDelay?: boolean;
  socket?: Socket;
  // Align with Node's OnReadOpts structure if possible, otherwise define based on usage
  onread?: { buffer?: Buffer | (() => Buffer); callback: (nread: number, buffer: Buffer) => void };
  signal?: AbortSignal;
  allowHalfOpen?: boolean;
}

interface Server extends NodeJS.EventEmitter {
  _connections: number;
  _handle: SocketListener<Server> | null; // Use SocketListener<Server>
  _usingWorkers: boolean;
  workers: any[]; // Assuming Worker type if available, else any
  _unref: boolean;
  listeningId: number;
  [bunSocketServerConnections]: number;
  [bunSocketServerOptions]: ServerOpts; // Use the extended ServerOpts
  allowHalfOpen: boolean;
  keepAlive: boolean;
  keepAliveInitialDelay: number;
  highWaterMark: number;
  pauseOnConnect: boolean;
  noDelay: boolean;
  maxConnections: number;
  [bunTlsSymbol]?: (port: number | undefined, host: string | undefined, isClient: boolean) => [any, typeof Socket];
  _emitCloseIfDrained(): void;
  [kRealListen](
    path: string | undefined,
    port: number | undefined,
    hostname: string | undefined,
    exclusive: boolean,
    ipv6Only: boolean,
    allowHalfOpen: boolean,
    reusePort: boolean,
    tls: any,
    contexts: Map<string, any> | null,
    onListen: ((...args: any[]) => void) | undefined,
  ): void;
  // getsockname(out: { port?: number; address?: string; family?: string }): number; // Defined on SocketListener

  // Methods from EventEmitter & Server definition
  address(): AddressInfo | string | null;
  close(callback?: (err?: Error) => void): this;
  getConnections(callback: (error: Error | null, count: number) => void): this;
  listen(...args: any[]): this;
  listening: boolean;
  ref(): this;
  unref(): this;
  [Symbol.asyncDispose](): Promise<void>;

  // EventEmitter methods
  emit(eventName: string | symbol, ...args: any[]): boolean;
  on(eventName: string | symbol, listener: (...args: any[]) => void): this;
  once(eventName: string | symbol, listener: (...args: any[]) => void): this;
}

// IPv4 Segment
const v4Seg = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
const v4Str = `(?:${v4Seg}\\.){3}${v4Seg}`;
var IPv4Reg: RegExp;

// IPv6 Segment
const v6Seg = "(?:[0-9a-fA-F]{1,4})";
var IPv6Reg: RegExp;

function isIPv4(s: string): boolean {
  return (IPv4Reg ??= new RegExp(`^${v4Str}$`)).test(s);
}

function isIPv6(s: string): boolean {
  return (IPv6Reg ??= new RegExp(
    "^(?:" +
      `(?:${v6Seg}:){7}(?:${v6Seg}|:)|` +
      `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|` +
      `(?:${v6Seg}:){5}(?::${v4Str}|(?::${v6Seg}){1,2}|:)|` +
      `(?:${v6Seg}:){4}(?:(?::${v6Seg}){0,1}:${v4Str}|(?::${v6Seg}){1,3}|:)|` +
      `(?:${v6Seg}:){3}(?:(?::${v6Seg}){0,2}:${v4Str}|(?::${v6Seg}){1,4}|:)|` +
      `(?:${v6Seg}:){2}(?:(?::${v6Seg}){0,3}:${v4Str}|(?::${v6Seg}){1,5}|:)|` +
      `(?:${v6Seg}:){1}(?:(?::${v6Seg}){0,4}:${v4Str}|(?::${v6Seg}){1,6}|:)|` +
      `(?::(?:(?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))` +
      ")(?:%[0-9a-zA-Z-.:]{1,})?$",
  )).test(s);
}

function isIP(s: string): 0 | 4 | 6 {
  if (isIPv4(s)) return 4;
  if (isIPv6(s)) return 6;
  return 0;
}

const { connect: bunConnect } = Bun;
var { setTimeout } = globalThis;

function endNT(socket: BunSocketHandle, callback: (err?: Error | null) => void, err?: Error | null) {
  socket.$end();
  callback(err);
}
function emitCloseNT(self: Socket, hasError: boolean) {
  if (hasError) {
    self.emit("close", hasError);
  } else {
    self.emit("close");
  }
}
function detachSocket(self: Socket) {
  if (!self) self = this as Socket;
  self._handle = null;
}
function destroyNT(self: Socket, err: Error | AbortSignal["reason"]) {
  self.destroy(err instanceof Error ? err : $makeAbortError(""));
}
function destroyWhenAborted(this: Socket, err: Event) {
  if (!this.destroyed) {
    this.destroy((err.target as AbortSignal).reason);
  }
}
// in node's code this callback is called 'onReadableStreamEnd' but that seemed confusing when `ReadableStream`s now exist
function onSocketEnd(this: Socket) {
  if (!this.allowHalfOpen) {
    this.write = writeAfterFIN;
  }
}
// Provide a better error message when we call end() as a result
// of the other side sending a FIN.  The standard 'write after end'
// is overly vague, and makes it seem like the user's code is to blame.
function writeAfterFIN(this: Socket, chunk: any, encodingOrCb?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void): boolean {
  if (!this.writableEnded) {
    // This should not happen normally, but guard against it.
    // Use the correct signature for Duplex.prototype.write
    if (typeof encodingOrCb === "function") {
      return Duplex.prototype.write.$call(this, chunk, encodingOrCb);
    } else {
      return Duplex.prototype.write.$call(this, chunk, encodingOrCb, cb);
    }
  }

  let encoding: BufferEncoding | undefined;
  if (typeof encodingOrCb === "function") {
    cb = encodingOrCb;
    encoding = undefined;
  } else {
    encoding = encodingOrCb;
  }

  const err = new Error("This socket has been ended by the other party");
  err.code = "EPIPE";
  if (typeof cb === "function") {
    process.nextTick(cb, err);
  }
  this.destroy(err);

  return false;
}

class ConnResetException extends Error {
  code = "ECONNRESET";
  path?: string;
  host?: string;
  port?: number;
  localAddress?: string;

  constructor(msg: string) {
    super(msg);
  }

  get ["constructor"]() {
    return Error;
  }
}

function onConnectEnd(this: Socket) {
  if (!this._hadError && this.secureConnecting) {
    const options = this[kConnectOptions];
    this._hadError = true;
    const error = new ConnResetException(
      "Client network socket disconnected before secure TLS connection was established",
    );
    error.path = options.path;
    error.host = options.host;
    error.port = options.port;
    error.localAddress = options.localAddress;
    this.destroy(error);
  }
}

// Use Socket<any> for client sockets created by the server
const SocketHandlers: NodeSocketHandler<any> = {
  close(self, error) { // Node's close takes an optional error
    if (!self || self[kclosed]) return;
    self[kclosed] = true;
    //socket cannot be used after close
    detachSocket(self);
    SocketEmitEndNT(self, error);
  },
  data(self, buffer) {
    if (!self || !self._handle) return;

    self.bytesRead += buffer.length;
    if (!self.push(buffer)) {
      self._handle.pause();
    }
  },
  drain(self) {
    if (!self || !self._handle) return;
    const callback = self[kwriteCallback];
    self.connecting = false;
    if (callback) {
      const writeChunk = self._pendingData;
      const encoding = self._pendingEncoding === ("buffer" as any) ? undefined : self._pendingEncoding;
      if (self._handle.$write(writeChunk || "", encoding)) {
        self._pendingData = self[kwriteCallback] = undefined;
        callback(null);
      } else {
        self._pendingData = undefined; // Keep callback for next drain
      }

      self[kBytesWritten] = self._handle.bytesWritten as number;
    }
    // Emit 'drain' only if the buffer was actually drained
    if (self.writableLength === 0) {
      self.emit("drain");
    }
  },
  end(self) {
    if (!self) return;
    // we just reuse the same code but we can push null or enqueue right away
    SocketEmitEndNT(self);
  },
  error(self, error) {
    if (!self) return;
    // ignoreHadError is implicitly handled by checking self._hadError
    if (self._hadError) return;
    self._hadError = true;

    const callback = self[kwriteCallback];
    if (callback) {
      self[kwriteCallback] = undefined;
      callback(error);
    }
    self.emit("error", error);
  },
  open(self) {
    if (!self || !self._handle) return;
    self._handle.timeout(Math.ceil(self.timeout / 1000));

    // _handle is already set before open is called in connect/attach
    self.connecting = false;
    const options = self[bunTLSConnectOptions];

    if (options) {
      const { session } = options;
      if (session) {
        (self as any).setSession(session); // Assume setSession exists on TLSSocket subclass
      }
    }

    if (self[kSetNoDelay]) {
      self._handle.setNoDelay(true);
    }

    if (self[kSetKeepAlive]) {
      self._handle.setKeepAlive(true, self[kSetKeepAliveInitialDelay]);
    }

    if (!self[kupgraded]) {
      self[kBytesWritten] = self._handle.bytesWritten as number;
      // this is not actually emitted on nodejs when socket used on the connection
      // this is already emmited on non-TLS socket and on TLS socket is emmited secureConnect after handshake
      self.emit("connect", self);
      self.emit("ready");
    }

    SocketHandlers.drain!(self);
  },
  handshake(self, success, verifyError) {
    if (!self || !self._handle) return;
    if (!success && verifyError?.code === "ECONNRESET") {
      // will be handled in onConnectEnd
      return;
    }

    self._securePending = false;
    self.secureConnecting = false;
    self._secureEstablished = !!success;

    self.emit("secure"); // Emit secure without arguments
    self.alpnProtocol = self._handle.alpnProtocol as string | false | null; // Cast result
    const tlsOptions = self[bunTLSConnectOptions];
    const checkServerIdentity = tlsOptions?.checkServerIdentity;
    if (!verifyError && typeof checkServerIdentity === "function" && self.servername) {
      const cert = self.getPeerCertificate(true);
      verifyError = checkServerIdentity(self.servername, cert);
    }
    if (self._requestCert || self._rejectUnauthorized) {
      if (verifyError) {
        self.authorized = false;
        self.authorizationError = verifyError.code || verifyError.message;
        if (self._rejectUnauthorized) {
          self.destroy(verifyError);
          return;
        }
      } else {
        self.authorized = true;
      }
    } else {
      self.authorized = true;
    }
    self.emit("secureConnect", verifyError);
    self.removeListener("end", onConnectEnd);
  },
  timeout(self) {
    if (!self) return;
    self.emit("timeout", self);
  },
};

const SocketEmitEndNT = (self: Socket, err?: Error) => {
  if (!self[kended]) {
    if (!self.allowHalfOpen) {
      self.write = writeAfterFIN;
    }
    self[kended] = true;
    self.push(null);
    self.emit("end");
  }
  if (err) {
    self.destroy(err);
  }
};

// Helper function to create the Socket wrapper for server connections
function createSocketWrapperForServer(server: Server, nativeSocket: BunSocketHandle): Socket<any> {
  const options = server[bunSocketServerOptions];
  const { [kSocketClass]: SClass } = options;
  const SocketConstructor = SClass || Socket;
  // Pass undefined for options
  const clientSocket = new (SocketConstructor as any)(undefined) as Socket<any>;

  // Assign native handle and server reference
  clientSocket._handle = nativeSocket;
  clientSocket.server = server;

  // Assign wrapper to native socket data
  (nativeSocket as any).data = clientSocket;

  // Call the open handler manually now that the wrapper exists
  // This ensures ServerHandlers.open receives the Socket wrapper
  ServerHandlers.open!(clientSocket); // Use non-null assertion

  return clientSocket;
}

const ServerHandlers: NodeSocketHandler<any> = {
  open(clientSocket) { // Parameter is now clientSocket: Socket<any>
    const server = clientSocket.server;
    if (!server || !clientSocket._handle) return; // Use clientSocket._handle

    const options = server[bunSocketServerOptions];
    const { pauseOnConnect, connectionListener, requestCert, rejectUnauthorized } = options;

    // Update properties on the existing clientSocket instance
    clientSocket.isServer = true; // Mark as server-side socket
    // clientSocket.server = server; // Already set in createSocketWrapperForServer
    clientSocket._requestCert = requestCert;
    clientSocket._rejectUnauthorized = rejectUnauthorized ?? false; // FIX TS2322 bool: Ensure boolean

    // kAttach logic is effectively handled by createSocketWrapperForServer and this open handler

    if (server.maxConnections && server[bunSocketServerConnections] >= server.maxConnections) {
      const data = {
        localAddress: clientSocket.localAddress,
        localPort: clientSocket.localPort || clientSocket._handle?.localPort,
        localFamily: clientSocket.localFamily,
        remoteAddress: clientSocket.remoteAddress,
        remotePort: clientSocket.remotePort,
        remoteFamily: clientSocket.remoteFamily || "IPv4",
      };

      clientSocket._handle?.end(); // Use the handle to end

      server.emit("drop", data);
      return;
    }

    const bunTLS = clientSocket[bunTlsSymbol];
    const isTLS = typeof bunTLS === "function";

    server[bunSocketServerConnections]++;

    if (typeof connectionListener === "function") {
      clientSocket.pauseOnConnect = pauseOnConnect;
      if (!isTLS) {
        connectionListener.$call(server, clientSocket); // Pass server as this, clientSocket as arg
      }
    }
    server.emit("connection", clientSocket); // Pass clientSocket
    if (!pauseOnConnect && !isTLS) {
      clientSocket.resume();
    }
  },
  data(clientSocket, buffer) { // Parameter is clientSocket
    if (!clientSocket || !clientSocket._handle) return; // Use clientSocket._handle

    clientSocket.bytesRead += buffer.length;
    if (!clientSocket.push(buffer)) {
      clientSocket._handle.pause(); // Use clientSocket._handle
    }
  },
  close(clientSocket, error) { // Parameter is clientSocket, Node's close takes an optional error
    const server = clientSocket?.server;
    if (!server) return;

    server[bunSocketServerConnections]--;
    if (clientSocket) {
      if (!clientSocket[kclosed]) {
        clientSocket[kclosed] = true;
        detachSocket(clientSocket);
        SocketEmitEndNT(clientSocket, error); // Pass error to SocketEmitEndNT
      }
    }

    server._emitCloseIfDrained();
  },
  end(clientSocket) { // Parameter is clientSocket
    if (!clientSocket) return;
    SocketEmitEndNT(clientSocket);
  },
  handshake(clientSocket, success, verifyError) { // Parameter is clientSocket
     if (!clientSocket || !clientSocket._handle) return; // Use clientSocket._handle
     const server = clientSocket.server;
     if (!server) return; // Ensure server exists

     if (!success && verifyError?.code === "ECONNRESET") {
       const err = new ConnResetException("socket hang up");
       clientSocket._emitTLSError(err);
       server.emit("tlsClientError", err, clientSocket);
       clientSocket._hadError = true;
       // error before handshake on the server side will only be emitted using tlsClientError
       clientSocket.destroy();
       return;
     }
     clientSocket._securePending = false;
     clientSocket.secureConnecting = false;
     clientSocket._secureEstablished = !!success;
     // Ensure servername is string | false | undefined
     const servernameSource = (clientSocket._handle as $ZigGeneratedClasses.TLSSocket).getServername(); // Use handle
     clientSocket.servername = typeof servernameSource === 'string' || servernameSource === false ? servernameSource : undefined; // Ensure type
     clientSocket.alpnProtocol = clientSocket._handle.alpnProtocol as string | false | null; // Use handle, cast result
     if (clientSocket._requestCert || clientSocket._rejectUnauthorized) {
       if (verifyError) {
         clientSocket.authorized = false;
         clientSocket.authorizationError = verifyError.code || verifyError.message;
         server.emit("tlsClientError", verifyError, clientSocket);
         if (clientSocket._rejectUnauthorized) {
           // if we reject we still need to emit secure
           clientSocket.emit("secure"); // Emit secure without arguments
           clientSocket.destroy(verifyError);
           return;
         }
       } else {
         clientSocket.authorized = true;
       }
     } else {
       clientSocket.authorized = true;
     }
     const connectionListener = server[bunSocketServerOptions]?.connectionListener;
     if (typeof connectionListener === "function") {
       connectionListener.$call(server, clientSocket); // Pass server as this, self (client socket) as arg
     }
     server.emit("secureConnection", clientSocket); // Pass self
     // after secureConnection event we emmit secure and secureConnect
     clientSocket.emit("secure"); // Emit secure without arguments
     clientSocket.emit("secureConnect", verifyError);
     if (!server.pauseOnConnect) {
       clientSocket.resume();
     }
  },
  error(clientSocket, error) { // Parameter is clientSocket
    if (!clientSocket) return;
    const server = clientSocket.server;
    if (!server) return;

    if (clientSocket._hadError) return;
    clientSocket._hadError = true;
    const bunTLS = clientSocket[bunTlsSymbol];

    if (typeof bunTLS === "function") {
      // Destroy socket if error happened before handshake's finish
      if (!clientSocket._secureEstablished) {
        clientSocket.destroy(error);
      } else if (
        clientSocket.isServer &&
        clientSocket._rejectUnauthorized &&
        /peer did not return a certificate/.test(error?.message)
      ) {
        // Ignore server's authorization errors
        clientSocket.destroy();
      } else {
        // Emit error
        clientSocket._emitTLSError(error);
        clientSocket.emit("_tlsError", error);
        server.emit("tlsClientError", error, clientSocket);
        SocketHandlers.error!(clientSocket, error); // Call base error handler
        return;
      }
    }
    SocketHandlers.error!(clientSocket, error); // Call base error handler
    server.emit("clientError", error, clientSocket);
  },
  timeout(clientSocket) { // Parameter is clientSocket
    if (!clientSocket) return;
    clientSocket.emit("timeout", clientSocket);
  },
  drain(clientSocket) { // Parameter is clientSocket
    if (!clientSocket) return;
    SocketHandlers.drain!(clientSocket); // Call base drain handler
  },
};


function Socket(this: Socket | void, options?: SocketConstructorOpts) {
  if (!(this instanceof Socket)) return new (Socket as any)(options); // Use any for constructor call

  const {
    socket,
    signal,
    allowHalfOpen = false,
    onread = null,
    noDelay = false,
    keepAlive = false,
    keepAliveInitialDelay = 0,
    objectMode, // Destructure to check
    readableObjectMode, // Destructure to check
    writableObjectMode, // Destructure to check
    ...opts
  } = options || {};

  if (objectMode) throw $ERR_INVALID_ARG_VALUE("options.objectMode", objectMode, "is not supported");
  if (readableObjectMode)
    throw $ERR_INVALID_ARG_VALUE("options.readableObjectMode", readableObjectMode, "is not supported");
  if (writableObjectMode)
    throw $ERR_INVALID_ARG_VALUE("options.writableObjectMode", writableObjectMode, "is not supported");

  Duplex.$call(this, {
    ...opts,
    allowHalfOpen,
    readable: true,
    writable: true,
    //For node.js compat do not emit close on destroy.
    emitClose: false,
    autoDestroy: true,
    // Handle strings directly.
    decodeStrings: false,
  } as DuplexOptions);
  this._parent = this;
  this._parentWrap = this;
  this[kpendingRead] = undefined;
  this[kupgraded] = null; // Initialize with null

  this[kSetNoDelay] = Boolean(noDelay);
  this[kSetKeepAlive] = Boolean(keepAlive);
  this[kSetKeepAliveInitialDelay] = ~~(keepAliveInitialDelay / 1000);

  this[khandlers] = SocketHandlers; // Assign directly
  this.bytesRead = 0;
  this[kBytesWritten] = undefined;
  this[kclosed] = false;
  this[kended] = false;
  this.connecting = false;
  this.localAddress = "127.0.0.1"; // Default, will be updated
  this.remotePort = undefined;
  this[bunTLSConnectOptions] = null;
  this.timeout = 0;
  this[kwriteCallback] = undefined;
  this._pendingData = undefined;
  this._pendingEncoding = undefined; // for compatibility
  this[kpendingRead] = undefined;
  this._hadError = false;
  this.isServer = false;
  this._handle = null;
  this._parent = undefined;
  this._parentWrap = undefined;
  this[ksocket] = undefined;
  this.server = undefined;
  this.pauseOnConnect = false;
  this._rejectUnauthorized = false; // Initialize as boolean
  // this[kupgraded] = undefined; // Already initialized to null

  // Shut down the socket when we're finished with it.
  this.on("end", onSocketEnd.bind(this)); // Bind `this`

  if (socket instanceof Socket) {
    this[ksocket] = socket;
  }
  if (onread) {
    if (typeof onread !== "object") {
      throw new TypeError("onread must be an object");
    }
    if (typeof onread.callback !== "function") {
      throw new TypeError("onread.callback must be a function");
    }
    // when the onread option is specified we use a different handlers object
    this[khandlers] = {
      ...SocketHandlers,
      data(self, buffer) {
        if (!self) return;
        try {
          // Node's internal callback expects (nread, buffer)
          if (onread.callback) {
            onread.callback(buffer.length, buffer);
          }
        } catch (e) {
          self.emit("error", e);
        }
      },
    } as NodeSocketHandler<any>; // Use any
  }
  if (signal) {
    if (signal.aborted) {
      process.nextTick(destroyNT, this, signal.reason);
    } else {
      signal.addEventListener("abort", destroyWhenAborted.bind(this));
    }
  }
}
$toClass(Socket, "Socket", Duplex);

Socket.prototype.address = function address(this: Socket) {
  return {
    address: this.localAddress,
    family: this.localFamily || "IPv4",
    port: this.localPort || 0,
  };
};

Socket.prototype._onTimeout = function (this: Socket) {
  // if there is pending data, write is in progress
  // so we suppress the timeout
  if (this._pendingData) {
    return;
  }

  const handle = this._handle;
  // if there is a handle, and it has pending data,
  // we suppress the timeout because a write is in progress
  if (handle && getBufferedAmount(handle) > 0) {
    return;
  }
  this.emit("timeout");
};

Object.defineProperty(Socket.prototype, "bufferSize", {
  get: function (this: Socket) {
    return this.writableLength;
  },
});

Object.defineProperty(Socket.prototype, "_bytesDispatched", {
  get: function (this: Socket) {
    return this[kBytesWritten] || 0;
  },
});

interface WriteVData {
  chunk: Buffer | string;
  encoding?: BufferEncoding;
}

interface WriteVDataObject extends Array<WriteVData> {
  allBuffers?: boolean;
}

Object.defineProperty(Socket.prototype, "bytesWritten", {
  get: function (this: Socket) {
    let bytes = this[kBytesWritten] || 0;
    const data = this._pendingData;
    // Access internal buffer correctly
    const writableBuffer = this._writableState?.getBuffer();
    // FIX TS2488: Add Array.isArray check
    if (Array.isArray(writableBuffer)) {
      // Iterate over the buffer elements
      for (const el of writableBuffer) {
        // Ensure el has the expected shape before accessing properties
        if (el && typeof el === 'object' && 'chunk' in el) {
           const chunk = el.chunk;
           const encoding = (el as any).encoding as BufferEncoding | undefined; // Cast encoding
           bytes += chunk instanceof Buffer ? chunk.length : Buffer.byteLength(chunk, encoding);
        }
      }
    }
    // FIX TS2488: Add Array.isArray check
    if (Array.isArray(data)) { // Use Array.isArray for TS guard
      const writeVData = data as WriteVDataObject;
      // Was a writev, iterate over chunks to get total length
      for (let i = 0; i < writeVData.length; i++) {
        const chunkData = writeVData[i]; // Use different name
        // Check if chunkData and chunkData.chunk exist
        if (chunkData && chunkData.chunk !== undefined) {
            const chunk = chunkData.chunk;
            const encoding = chunkData.encoding;
            if (writeVData.allBuffers || chunk instanceof Buffer) bytes += (chunk as Buffer).length;
            else bytes += Buffer.byteLength(chunk as string, encoding); // Cast chunk
        }
      }
    } else if (data) {
      // Assuming data is Buffer or string here
      bytes += Buffer.byteLength(data as string | Buffer); // Cast needed
    }
    return bytes;
  },
});

Socket.prototype[kAttach] = function (this: Socket, port: number | undefined, socket: BunSocketHandle) {
  this.remotePort = port;
  this._handle = socket; // Assign the native handle
  (socket as any).data = this; // Assign the wrapper to the native handle's data

  socket.timeout(Math.ceil(this.timeout / 1000));
  this.connecting = false;

  if (this[kSetNoDelay]) {
    socket.setNoDelay(true);
  }

  if (this[kSetKeepAlive]) {
    socket.setKeepAlive(true, this[kSetKeepAliveInitialDelay]);
  }

  if (!this[kupgraded]) {
    this[kBytesWritten] = socket.bytesWritten as number; // Keep cast
    // this is not actually emitted on nodejs when socket used on the connection
    // this is already emmited on non-TLS socket and on TLS socket is emmited secureConnect after handshake
    this.emit("connect", this);
    this.emit("ready");
  }
  SocketHandlers.drain!(this); // Call drain on the wrapper
};

Socket.prototype[kCloseRawConnection] = function (this: Socket) {
  const connection = this[kupgraded];
  if (connection) {
    connection.connecting = false;
    connection._handle = null;
    connection.unref();
    connection.destroy();
  }
};

Socket.prototype.connect = function connect(this: Socket, ...args: any[]) {
  const [options, connectListener] =
    $isArray(args[0]) && (args[0] as any)[normalizedArgsSymbol]
      ? // args have already been normalized.
        // Normalized array is passed as the first and only argument.
        ($assert(args[0].length == 2 && typeof args[0][0] === "object"), args[0])
      : normalizeArgs(args);
  let connection = this[ksocket];
  let upgradeDuplex = false;
  let {
    fd,
    port,
    host,
    path,
    socket,
    localAddress,
    localPort,
    rejectUnauthorized,
    pauseOnConnect,
    servername,
    checkServerIdentity,
    session,
  } = options;
  if (localAddress && !isIP(localAddress)) {
    throw $ERR_INVALID_IP_ADDRESS(localAddress);
  }
  if (localPort) {
    validateNumber(localPort, "options.localPort");
  }
  // Ensure servername is string | false | undefined
  const servernameSource = servername as unknown;
  this.servername = typeof servernameSource === 'string' || servernameSource === false ? servernameSource : undefined;
  if (socket) {
    connection = socket;
  }
  if (fd) {
    bunConnect({
      data: this,
      fd: fd,
      socket: { ...this[khandlers], allowHalfOpen: this.allowHalfOpen } as any, // Cast handler type
    } as any).catch(error => { // Cast options to any
      if (!this.destroyed) {
        this.emit("error", error);
        this.emit("close");
      }
    });
  }
  this.pauseOnConnect = pauseOnConnect;
  if (!pauseOnConnect) {
    process.nextTick(() => {
      this.resume();
    });
    this.connecting = true;
  }
  if (fd) {
    return this;
  }
  if (
    // TLSSocket already created a socket and is forwarding it here. This is a private API.
    !(socket && $isObject(socket) && socket instanceof Duplex) &&
    // public api for net.Socket.connect
    port === undefined &&
    path == null
  ) {
    throw $ERR_MISSING_ARGS(["options", "port", "path"]);
  }
  this.remotePort = port as number | undefined; // Cast port
  const bunTLS = this[bunTlsSymbol];
  var tls: any = undefined;
  if (typeof bunTLS === "function") {
    tls = bunTLS.$call(this, port, host, true);
    // Client always request Cert
    this._requestCert = true;
    if (tls) {
      // Ensure rejectUnauthorized is boolean
      this._rejectUnauthorized = !!(typeof rejectUnauthorized === "boolean" ? rejectUnauthorized : tls?.rejectUnauthorized);
      tls.rejectUnauthorized = this._rejectUnauthorized;

      tls.requestCert = true;
      tls.session = session || tls.session;
      // Ensure servername is string | false | undefined
      const tlsServername = tls.servername as unknown;
      tls.servername = typeof tlsServername === 'string' || tlsServername === false ? tlsServername : undefined;
      tls.checkServerIdentity = checkServerIdentity || tls.checkServerIdentity;
      this[bunTLSConnectOptions] = tls;
      if (!connection && tls.socket) {
        connection = tls.socket;
      }
    }
    if (connection) {
      if (
        typeof connection !== "object" ||
        !(connection instanceof Socket) ||
        typeof connection[bunTlsSymbol] === "function"
      ) {
        if (connection instanceof Duplex) {
          upgradeDuplex = true;
        } else {
          throw new TypeError("socket must be an instance of net.Socket or Duplex");
        }
      }
    }
    this.authorized = false;
    this.secureConnecting = true;
    this._secureEstablished = false;
    this._securePending = true;
    if (connectListener) this.on("secureConnect", connectListener);
    this[kConnectOptions] = options;
    this.prependListener("end", onConnectEnd.bind(this)); // Bind `this`
  } else if (connectListener) this.on("connect", connectListener);
  // start using existing connection
  try {
    // reset the underlying writable object when establishing a new connection
    // this is a function on `Duplex`, originally defined on `Writable`
    // https://github.com/nodejs/node/blob/c5cfdd48497fe9bd8dbd55fd1fca84b321f48ec1/lib/net.js#L311
    // https://github.com/nodejs/node/blob/c5cfdd48497fe9bd8dbd55fd1fca84b321f48ec1/lib/net.js#L1126
    this._undestroy();
    if (connection) {
      const socketHandle = connection._handle;
      if (!upgradeDuplex && socketHandle) {
        // if is named pipe socket we can upgrade it using the same wrapper than we use for duplex
        upgradeDuplex = isNamedPipeSocket(socketHandle);
      }
      if (upgradeDuplex) {
        this.connecting = true;
        this[kupgraded] = connection;
        const [result, events] = upgradeDuplexToTLS(connection as unknown as Duplex, { // Cast connection to Duplex
          data: this,
          tls,
          socket: this[khandlers] as any, // Cast handler type
        });
        connection.on("data", events[0]);
        connection.on("end", events[1]);
        connection.on("drain", events[2]);
        connection.on("close", events[3]);
        this._handle = result;
      } else {
        if (socketHandle) {
          this.connecting = true;
          this[kupgraded] = connection;
          const result = socketHandle.upgradeTLS({
            data: this,
            tls,
            socket: this[khandlers] as any, // Cast handler type
          });
          if (result) {
            const [raw, tlsSocket] = result;
            // replace socket
            connection._handle = raw;
            this.once("end", this[kCloseRawConnection].bind(this)); // Bind `this`
            (raw as any).connecting = false; // Assuming raw has connecting property
            this._handle = tlsSocket as BunSocketHandle; // Cast result
          } else {
            this._handle = null;
            throw new Error("Invalid socket");
          }
        } else {
          // wait to be connected
          connection.once("connect", () => {
            const socketHandle = connection!._handle;
            if (!upgradeDuplex && socketHandle) {
              // if is named pipe socket we can upgrade it using the same wrapper than we use for duplex
              upgradeDuplex = isNamedPipeSocket(socketHandle);
            }
            if (upgradeDuplex) {
              this.connecting = true;
              this[kupgraded] = connection;
              const [result, events] = upgradeDuplexToTLS(connection! as unknown as Duplex, { // Cast connection to Duplex
                data: this,
                tls,
                socket: this[khandlers] as any, // Cast handler type
              });
              connection!.on("data", events[0]);
              connection!.on("end", events[1]);
              connection!.on("drain", events[2]);
              connection!.on("close", events[3]);
              this._handle = result;
            } else {
              this.connecting = true;
              this[kupgraded] = connection;
              const result = socketHandle!.upgradeTLS({
                data: this,
                tls,
                socket: this[khandlers] as any, // Cast handler type
              });
              if (result) {
                const [raw, tlsSocket] = result;
                // replace socket
                connection!._handle = raw;
                this.once("end", this[kCloseRawConnection].bind(this)); // Bind `this`
                (raw as any).connecting = false; // Assuming raw has connecting property
                this._handle = tlsSocket as BunSocketHandle; // Cast result
              } else {
                this._handle = null;
                throw new Error("Invalid socket");
              }
            }
          });
        }
      }
    } else if (path) {
      // start using unix socket
      bunConnect({
        data: this,
        unix: path,
        socket: { ...this[khandlers], allowHalfOpen: this.allowHalfOpen } as any, // Cast handler type
        tls,
      } as any).catch(error => { // Cast options to any
        if (!this.destroyed) {
          this.emit("error", error);
          this.emit("close");
        }
      });
    } else {
      // default start
      bunConnect({
        data: this,
        hostname: host || "localhost",
        port: port!, // Port is guaranteed to be defined here or path would be set
        socket: { ...this[khandlers], allowHalfOpen: this.allowHalfOpen } as any, // Cast handler type
        tls,
      } as any).catch(error => { // Cast options to any
        if (!this.destroyed) {
          this.emit("error", error);
          this.emit("close");
        }
      });
    }
  } catch (error) {
    process.nextTick(emitErrorAndCloseNextTick, this, error);
  }
  return this;
};

Socket.prototype.end = function end(this: Socket, ...args: any[]) {
  if (!this._readableState.endEmitted) {
    this.secureConnecting = false;
  }
  return Duplex.prototype.end.$apply(this, args);
};

Socket.prototype._destroy = function _destroy(this: Socket, err: Error | null, callback: (error?: Error | null) => void) {
  this.connecting = false;
  const { ending } = this._writableState;

  // lets make sure that the writable side is closed
  if (!ending) {
    // at this state destroyed will be true but we need to close the writable side
    this._writableState.destroyed = false;
    this.end();

    // we now restore the destroyed flag
    this._writableState.destroyed = true;
  }

  detachSocket(this);
  callback(err);
  process.nextTick(emitCloseNT, this, !!err);
};

Socket.prototype._final = function _final(this: Socket, callback: (error?: Error | null) => void) {
  if (this.connecting) {
    return this.once("connect", () => this._final(callback));
  }
  const socket = this._handle;

  // already closed call destroy
  if (!socket) return callback();

  // emit FIN allowHalfOpen only allow the readable side to close first
  process.nextTick(endNT, socket, callback, null); // Add null for err argument
};

Object.defineProperty(Socket.prototype, "localFamily", {
  get: function (this: Socket) {
    return this._handle?.localFamily || "IPv4"; // TODO: Get actual family from handle
  },
});

Object.defineProperty(Socket.prototype, "localPort", {
  get: function (this: Socket) {
    return this._handle?.localPort;
  },
});

Object.defineProperty(Socket.prototype, "_connecting", {
  get: function (this: Socket) {
    return this.connecting;
  },
});

Object.defineProperty(Socket.prototype, "pending", {
  get: function (this: Socket) {
    return !this._handle || this.connecting;
  },
});

Socket.prototype.resume = function resume(this: Socket) {
  if (!this.connecting) {
    this._handle?.resume();
  }
  return Duplex.prototype.resume.$call(this);
};

Socket.prototype.pause = function pause(this: Socket) {
  if (!this.destroyed) {
    this._handle?.pause();
  }
  return Duplex.prototype.pause.$call(this);
};

Socket.prototype.read = function read(this: Socket, size?: number) {
  if (!this.connecting) {
    this._handle?.resume();
  }
  return Duplex.prototype.read.$call(this, size);
};

Socket.prototype._read = function _read(this: Socket, size: number) {
  const socket = this._handle;
  if (this.connecting || !socket) {
    this.once("connect", () => this._read(size));
  } else {
    socket?.resume();
  }
};

Socket.prototype._reset = function _reset(this: Socket, err?: Error) {
  this.resetAndClosing = true;
  return this.destroy(err);
};

Object.defineProperty(Socket.prototype, "readyState", {
  get: function (this: Socket) {
    if (this.connecting) return "opening";
    if (this.readable && this.writable) return "open";
    if (this.readable && !this.writable) return "readOnly";
    if (!this.readable && this.writable) return "writeOnly";
    return "closed";
  },
});

Socket.prototype.ref = function ref(this: Socket) {
  const socket = this._handle;
  if (!socket) {
    this.once("connect", this.ref);
    return this;
  }
  socket.ref();
  return this;
};

Object.defineProperty(Socket.prototype, "remoteAddress", {
  get: function (this: Socket) {
    return this._handle?.remoteAddress;
  },
});

Object.defineProperty(Socket.prototype, "remoteFamily", {
  get: function (this: Socket) {
    return this._handle?.remoteFamily || "IPv4"; // TODO: Get actual family from handle
  },
});

Socket.prototype.resetAndDestroy = function resetAndDestroy(this: Socket) {
  if (this._handle) {
    if (this.connecting) {
      this.once("connect", () => this._reset());
    } else {
      this._reset();
    }
  } else {
    this.destroy($ERR_SOCKET_CLOSED());
  }
  return this;
};

Socket.prototype.setKeepAlive = function setKeepAlive(this: Socket, enable = false, initialDelayMsecs = 0) {
  enable = Boolean(enable);
  const initialDelay = ~~(initialDelayMsecs / 1000);

  if (!this._handle) {
    this[kSetKeepAlive] = enable;
    this[kSetKeepAliveInitialDelay] = initialDelay;
    return this;
  }
  if (!this._handle.setKeepAlive) {
    return this;
  }
  if (enable !== this[kSetKeepAlive] || (enable && this[kSetKeepAliveInitialDelay] !== initialDelay)) {
    this[kSetKeepAlive] = enable;
    this[kSetKeepAliveInitialDelay] = initialDelay;
    this._handle.setKeepAlive(enable, initialDelay);
  }
  return this;
};

Socket.prototype.setNoDelay = function setNoDelay(this: Socket, enable = true) {
  // Backwards compatibility: assume true when `enable` is omitted
  enable = Boolean(enable === undefined ? true : enable);

  if (!this._handle) {
    this[kSetNoDelay] = enable;
    return this;
  }
  if (this._handle.setNoDelay && enable !== this[kSetNoDelay]) {
    this[kSetNoDelay] = enable;
    this._handle.setNoDelay(enable);
  }
  return this;
};

Socket.prototype.setTimeout = function setTimeout(this: Socket, timeout: number, callback?: () => void) {
  timeout = getTimerDuration(timeout, "msecs");
  // internally or timeouts are in seconds
  // we use Math.ceil because 0 would disable the timeout and less than 1 second but greater than 1ms would be 1 second (the minimum)
  if (callback !== undefined) {
    validateFunction(callback, "callback");
    this.once("timeout", callback);
  }
  this._handle?.timeout(Math.ceil(timeout / 1000));
  this.timeout = timeout;
  return this;
};

Socket.prototype._unrefTimer = function _unrefTimer(this: Socket) {
  // for compatibility
};

Socket.prototype.unref = function unref(this: Socket) {
  const socket = this._handle;
  if (!socket) {
    this.once("connect", this.unref);
    return this;
  }
  socket.unref();
  return this;
};

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L785
Socket.prototype.destroySoon = function destroySoon(this: Socket) {
  if (this.writable) this.end();
  if (this.writableFinished) this.destroy();
  else this.once("finish", this.destroy);
};

//TODO: migrate to native
Socket.prototype._writev = function _writev(this: Socket, data: WriteVDataObject, callback: (error?: Error | null) => void) {
  const allBuffers = data.allBuffers;
  const chunks = data;
  const buffersToWrite: Buffer[] = [];
  if (allBuffers) {
    if (data.length === 1) {
      return this._write(data[0].chunk as Buffer, undefined, callback); // Pass undefined for buffer encoding
    }
    for (let i = 0; i < data.length; i++) {
      buffersToWrite.push(data[i].chunk as Buffer); // Modify in place, assuming Buffer chunks
    }
  } else {
    if (data.length === 1) {
      const { chunk, encoding } = data[0];
      return this._write(chunk, encoding, callback);
    }
    for (let i = 0; i < data.length; i++) {
      const { chunk, encoding } = data[i];
      if (typeof chunk === "string") {
        buffersToWrite.push(Buffer.from(chunk, encoding));
      } else {
        buffersToWrite.push(chunk as Buffer);
      }
    }
  }
  const chunk = Buffer.concat(buffersToWrite); // Now chunks are guaranteed Buffers
  return this._write(chunk, undefined, callback); // Pass undefined for buffer encoding
};

Socket.prototype._write = function _write(
  this: Socket,
  chunk: any,
  encoding: BufferEncoding | undefined,
  callback: (error?: Error | null) => void,
) {
  // If we are still connecting, then buffer this for later.
  // The Writable logic will buffer up any more writes while
  // waiting for this one to be done.
  if (this.connecting) {
    this[kwriteCallback] = callback;
    this._pendingData = chunk;
    this._pendingEncoding = encoding;
    function onClose() {
      if (callback) {
        callback($ERR_SOCKET_CLOSED_BEFORE_CONNECTION());
      }
    }
    this.once("connect", function connect() {
      this.off("close", onClose);
    });
    this.once("close", onClose);
    return;
  }
  this._pendingData = null;
  this._pendingEncoding = undefined;
  this[kwriteCallback] = undefined;
  const socket = this._handle;
  if (!socket) {
    callback($ERR_SOCKET_CLOSED());
    return false;
  }
  // Handle 'buffer' encoding case
  const effectiveEncoding = encoding === ("buffer" as any) ? undefined : encoding;
  const success = socket.$write(chunk, effectiveEncoding);
  this[kBytesWritten] = socket.bytesWritten as number;
  if (success) {
    callback();
  } else if (this[kwriteCallback]) {
    callback(new Error("overlapping _write()"));
  } else {
    this[kwriteCallback] = callback;
  }
};

// Define write with overloads to satisfy the interface
Socket.prototype.write = function write(
  this: Socket,
  chunk: any,
  encodingOrCb?: BufferEncoding | ((error: Error | null | undefined) => void),
  cb?: (error: Error | null | undefined) => void,
): boolean {
  let encoding: BufferEncoding | undefined;
  if (typeof encodingOrCb === "function") {
    cb = encodingOrCb;
    encoding = undefined;
  } else {
    encoding = encodingOrCb;
  }
  return Duplex.prototype.write.$call(this, chunk, encoding, cb);
} as Socket['write']; // Cast to the correct type

function createConnection(port: any, host?: any, connectListener?: any) {
  if (typeof port === "object") {
    // port is option pass Socket options and let connect handle connection options
    return new (Socket as any)(port).connect(port, host, connectListener);
  }
  // port is path or host, let connect handle this
  return new (Socket as any)().connect(port, host, connectListener);
}

const connect = createConnection;

function Server(this: Server | void);
function Server(this: Server | void, options?: null | undefined);
function Server(this: Server | void, connectionListener: (this: Server, socket: Socket) => void);
function Server(this: Server | void, options: ServerOpts, connectionListener?: (this: Server, socket: Socket) => void);
function Server(this: Server | void, options?: ServerOpts | ((this: Server, socket: Socket) => void) | null, connectionListener?: (this: Server, socket: Socket) => void) {
  if (!(this instanceof Server)) {
    return new (Server as any)(options as any, connectionListener); // Use any for constructor call
  }

  EventEmitter.$apply(this);

  if (typeof options === "function") {
    connectionListener = options;
    options = {};
  } else if (options == null || typeof options === "object") {
    options = { ...options };
  } else {
    throw $ERR_INVALID_ARG_TYPE("options", ["Object", "Function"], options);
  }

  $assert(typeof Duplex.getDefaultHighWaterMark === "function");

  // https://nodejs.org/api/net.html#netcreateserveroptions-connectionlistener
  const {
    maxConnections, //
    allowHalfOpen = false,
    keepAlive = false,
    keepAliveInitialDelay = 0,
    highWaterMark = Duplex.getDefaultHighWaterMark(false), // Pass false for objectMode
    pauseOnConnect = false,
    noDelay = false,
  } = options;

  this._connections = 0;

  this._handle = null;
  this._usingWorkers = false;
  this.workers = [];
  this._unref = false;
  this.listeningId = 1;

  this[bunSocketServerConnections] = 0;
  this[bunSocketServerOptions] = {} as any; // Initialize properly
  this.allowHalfOpen = allowHalfOpen;
  this.keepAlive = keepAlive;
  this.keepAliveInitialDelay = keepAliveInitialDelay;
  this.highWaterMark = highWaterMark;
  this.pauseOnConnect = pauseOnConnect ?? false; // Provide default
  this.noDelay = noDelay;
  this.maxConnections = Number.isSafeInteger(maxConnections) && maxConnections! > 0 ? maxConnections! : 0;
  // TODO: options.blockList

  options.connectionListener = connectionListener;
  this[bunSocketServerOptions] = options;
}
$toClass(Server, "Server", EventEmitter);

Object.defineProperty(Server.prototype, "listening", {
  get(this: Server) {
    return !!this._handle;
  },
});

Server.prototype.ref = function ref(this: Server) {
  this._unref = false;
  this._handle?.ref();
  return this;
};

Server.prototype.unref = function unref(this: Server) {
  this._unref = true;
  this._handle?.unref();
  return this;
};

Server.prototype.close = function close(this: Server, callback?: (err?: Error) => void) {
  if (typeof callback === "function") {
    if (!this._handle) {
      this.once("close", function close() {
        callback($ERR_SERVER_NOT_RUNNING());
      });
    } else {
      this.once("close", callback);
    }
  }

  if (this._handle) {
    this._handle.stop(false);
    this._handle = null;
  }

  this._emitCloseIfDrained();

  return this;
};

Server.prototype[Symbol.asyncDispose] = function (this: Server) {
  const { resolve, reject, promise } = Promise.withResolvers<void>();
  this.close(function (err) {
    if (err) reject(err);
    else resolve();
  });
  return promise;
};

Server.prototype._emitCloseIfDrained = function _emitCloseIfDrained(this: Server) {
  if (this._handle || this[bunSocketServerConnections] > 0) {
    return;
  }
  process.nextTick(() => {
    this.emit("close");
  });
};

Server.prototype.address = function address(this: Server): AddressInfo | string | null {
  const server = this._handle;
  if (server) {
    const unix = (server as UnixSocketListener<Server>).unix; // Provide type argument
    if (unix) {
      return unix;
    }

    const out: { port?: number; address?: string; family?: string } = {};
    // Assuming getsockname exists and returns an error code (0 for success)
    const err = (server as $ZigGeneratedClasses.Listener).getsockname(out);
    if (err) throw new ErrnoException(err, "address");
    // Ensure the returned object matches AddressInfo structure
    return {
      address: out.address || "",
      family: out.family || "IPv4", // Default or determine family
      port: out.port || 0,
    };
  }
  return null;
};

Server.prototype.getConnections = function getConnections(this: Server, callback: (error: Error | null, count: number) => void) {
  if (typeof callback === "function") {
    //in Bun case we will never error on getConnections
    //node only errors if in the middle of the couting the server got disconnected, what never happens in Bun
    //if disconnected will only pass null as well and 0 connected
    callback(null, this._handle ? this[bunSocketServerConnections] : 0);
  }
  return this;
};

Server.prototype.listen = function listen(this: Server, ...args: any[]) {
  let port: number | undefined;
  let hostname: string | undefined;
  let onListen: ((...args: any[]) => void) | undefined;
  let backlog: number | undefined;
  let path: string | undefined;
  let exclusive = false;
  let allowHalfOpen = false;
  let reusePort = false;
  let ipv6Only = false;

  const arg0 = args[0];
  const arg1 = args[1];
  const arg2 = args[2];

  // Determine arguments based on type and position
  if (typeof arg0 === "string" && isPipeName(arg0)) {
    path = arg0;
    if (typeof arg1 === "number") backlog = arg1;
    if (typeof arg1 === "function") onListen = arg1;
    else if (typeof arg2 === "function") onListen = arg2;
  } else if (typeof arg0 === "number" || arg0 === undefined || arg0 === null) {
    port = arg0 ?? 0;
    if (typeof arg1 === "string") {
      hostname = arg1;
      if (typeof arg2 === "number") backlog = arg2;
      if (typeof arg2 === "function") onListen = arg2;
      else if (typeof args[3] === "function") onListen = args[3];
    } else if (typeof arg1 === "number") {
      backlog = arg1;
      if (typeof arg2 === "function") onListen = arg2;
    } else if (typeof arg1 === "function") {
      onListen = arg1;
    }
  } else if (typeof arg0 === "object" && arg0 !== null) {
    const options = arg0 as ServerOpts;
    addServerAbortSignalOption(this, options);

    hostname = options.host;
    exclusive = options.exclusive ?? false;
    path = options.path;
    port = options.port as number | undefined; // Cast port
    ipv6Only = options.ipv6Only ?? false;
    allowHalfOpen = options.allowHalfOpen ?? false;
    reusePort = options.reusePort ?? false;
    backlog = options.backlog;

    const isLinux = process.platform === "linux";

    if (port === undefined && path === undefined) {
      let message = 'The argument \'options\' must have the property "port" or "path"';
      try {
        message = `${message}. Received ${JSON.stringify(options)}`;
      } catch {}
      const error = new TypeError(message);
      error.code = "ERR_INVALID_ARG_VALUE";
      throw error;
    } else if (port !== undefined && (!Number.isSafeInteger(port) || port < 0)) {
      throw $ERR_SOCKET_BAD_PORT(String(port)); // Cast port to string
    } else if (path !== undefined) {
      const isAbstractPath = path.startsWith("\0");
      if (isLinux && isAbstractPath && (options.writableAll || options.readableAll)) {
        const message = `The argument 'options' can not set readableAll or writableAll to true when path is abstract unix socket. Received ${JSON.stringify(options)}`;
        const error = new TypeError(message);
        error.code = "ERR_INVALID_ARG_VALUE";
        throw error;
      }
      port = undefined; // Path takes precedence
    } else if (port === undefined) {
      port = 0;
    }

    if (typeof options.callback === "function") onListen = options.callback;
    else if (typeof arg1 === "function") onListen = arg1; // Handle listen({port: 80}, cb)
  } else {
    throw $ERR_INVALID_ARG_TYPE("port", ["number", "string", "object"], arg0);
  }

  hostname = hostname || "::";

  if (this._handle) {
    throw $ERR_SERVER_ALREADY_LISTEN();
  }

  if (onListen != null) {
    this.once("listening", onListen);
  }

  try {
    var tls: any = undefined;
    var TLSSocketClass: (new (opts?: SocketConstructorOpts) => Socket<any>) | undefined = undefined;
    const bunTLS = this[bunTlsSymbol];
    const options = this[bunSocketServerOptions];
    let contexts: Map<string, any> | null = null;
    if (typeof bunTLS === "function") {
      [tls, TLSSocketClass] = bunTLS.$call(this, port, hostname, false);
      // Assign tls.serverName to options.servername (string | undefined)
      const tlsServerName = tls.serverName as unknown;
      options.servername = typeof tlsServerName === 'string' ? tlsServerName : undefined;
      options[kSocketClass] = TLSSocketClass;
      contexts = tls.contexts;
      if (!tls.requestCert) {
        tls.rejectUnauthorized = false;
      }
    } else {
      options[kSocketClass] = Socket as any; // Cast Socket function to constructor type
    }

    listenInCluster(
      this,
      null, // address (unused when path or port/hostname provided)
      port,
      4, // addressType (assuming IPv4/IPv6 based on hostname)
      backlog,
      undefined, // fd
      exclusive,
      ipv6Only,
      allowHalfOpen,
      reusePort,
      undefined, // flags
      undefined, // cluster options
      path,
      hostname,
      tls,
      contexts,
      onListen,
    );
  } catch (err) {
    // Use setTimeout with a wrapper function
    setTimeout(() => emitErrorNextTick(this, err as Error), 1);
  }
  return this;
};

Server.prototype[kRealListen] = function (
  this: Server,
  path,
  port,
  hostname,
  exclusive,
  ipv6Only,
  allowHalfOpen,
  reusePort,
  tls,
  contexts, // Map<string, any> | null
  _onListen,
) {
  const serverOptions = this[bunSocketServerOptions];
  const effectiveAllowHalfOpen = allowHalfOpen || serverOptions?.allowHalfOpen || false;
  const effectiveReusePort = reusePort || serverOptions?.reusePort || false;
  const effectiveIPv6Only = ipv6Only || serverOptions?.ipv6Only || false;
  const effectiveExclusive = exclusive || serverOptions?.exclusive || false;

  // Define the Bun socket handler that creates the Socket wrapper
  const bunHandler: BunSocketHandler<Server> = {
    open: (nativeSocket: BunSocketHandle) => {
      // This creates the Socket wrapper and calls ServerHandlers.open
      createSocketWrapperForServer(this, nativeSocket);
    },
    data: (nativeSocket: BunSocketHandle, buffer: Buffer) => {
      const clientSocket = (nativeSocket as any).data as Socket<any>;
      if (clientSocket) ServerHandlers.data!(clientSocket, buffer); // Call ServerHandlers with wrapper
    },
    close: (nativeSocket: BunSocketHandle, hadError: boolean) => {
      const clientSocket = (nativeSocket as any).data as Socket<any>;
      // Pass error if hadError is true
      if (clientSocket) ServerHandlers.close!(clientSocket, hadError ? $ERR_SOCKET_CLOSED() : undefined); // Call ServerHandlers with wrapper
    },
    drain: (nativeSocket: BunSocketHandle) => {
      const clientSocket = (nativeSocket as any).data as Socket<any>;
      if (clientSocket) ServerHandlers.drain!(clientSocket); // Call ServerHandlers with wrapper
    },
    error: (nativeSocket: BunSocketHandle, error: Error) => {
      const clientSocket = (nativeSocket as any).data as Socket<any>;
      if (clientSocket) ServerHandlers.error!(clientSocket, error); // Call ServerHandlers with wrapper
    },
    end: (nativeSocket: BunSocketHandle) => {
      const clientSocket = (nativeSocket as any).data as Socket<any>;
      if (clientSocket) ServerHandlers.end!(clientSocket); // Call ServerHandlers with wrapper
    },
    handshake: (nativeSocket: BunSocketHandle, success: boolean, authorizationError: Error | null) => {
      const clientSocket = (nativeSocket as any).data as Socket<any>;
      if (clientSocket) ServerHandlers.handshake!(clientSocket, success, authorizationError); // Call ServerHandlers with wrapper
    },
    timeout: (nativeSocket: BunSocketHandle) => {
      const clientSocket = (nativeSocket as any).data as Socket<any>;
      if (clientSocket) ServerHandlers.timeout!(clientSocket); // Call ServerHandlers with wrapper
    },
    binaryType: "buffer",
  };


  if (path) {
    this._handle = Bun.listen({
      unix: path,
      tls,
      allowHalfOpen: effectiveAllowHalfOpen,
      reusePort: effectiveReusePort,
      ipv6Only: effectiveIPv6Only,
      exclusive: effectiveExclusive,
      socket: bunHandler, // Pass the intermediate handler
    } as unknown as Bun.UnixSocketOptions<Server>); // Cast options object
  } else {
    this._handle = Bun.listen({
      port: port!, // Port is guaranteed non-undefined here
      hostname: hostname!, // Hostname is guaranteed non-undefined here
      tls,
      allowHalfOpen: effectiveAllowHalfOpen,
      reusePort: effectiveReusePort,
      ipv6Only: effectiveIPv6Only,
      exclusive: effectiveExclusive,
      socket: bunHandler, // Pass the intermediate handler
    } as unknown as Bun.TCPSocketListenOptions<Server>); // Cast options object
  }

  //make this instance available on handlers
  (this._handle as any).data = this; // Cast to any to assign data

  // FIX TS2488: Add null check for contexts and use entries()
  if (contexts) {
    for (const [name, context] of contexts.entries()) { // Use entries() for Map iteration
      addServerName(this._handle as SocketListener<Server>, name, context); // Cast handle
    }
  }

  // Unref the handle if the server was unref'ed prior to listening
  if (this._unref) this.unref();

  // We must schedule the emitListeningNextTick() only after the next run of
  // the event loop's IO queue. Otherwise, the server may not actually be listening
  // when the 'listening' event is emitted.
  //
  // That leads to all sorts of confusion.
  //
  // process.nextTick() is not sufficient because it will run before the IO queue.
  setTimeout(() => emitListeningNextTick(this), 1);
};

// getsockname is defined on SocketListener, accessed via address()
// Server.prototype.getsockname = function getsockname(this: Server, out: { port?: number; address?: string; family?: string }) {
//   const addr = this.address();
//   if (addr && typeof addr === "object" && "port" in addr) {
//     out.port = addr.port;
//     out.address = addr.address;
//     out.family = addr.family;
//     return 0; // Success
//   }
//   return -1; // Indicate error or no address
// };

function emitErrorNextTick(self: Server | Socket, error: Error) {
  self.emit("error", error);
}

function emitErrorAndCloseNextTick(self: Socket, error: Error) {
  self.emit("error", error);
  self.emit("close");
}

function addServerAbortSignalOption(self: Server, options: { signal?: AbortSignal }) {
  if (options?.signal === undefined) {
    return;
  }
  validateAbortSignal(options.signal, "options.signal");
  const { signal } = options;
  const onAborted = () => self.close();
  if (signal.aborted) {
    process.nextTick(onAborted);
  } else {
    signal.addEventListener("abort", onAborted);
  }
}

function emitListeningNextTick(self: Server) {
  if (!self._handle) return;
  self.emit("listening");
}

let cluster: typeof import("node:cluster") | undefined;
function listenInCluster(
  server: Server,
  address: string | null,
  port: number | undefined,
  addressType: number,
  backlog: number | undefined,
  fd: number | undefined,
  exclusive: boolean,
  ipv6Only: boolean,
  allowHalfOpen: boolean,
  reusePort: boolean,
  flags: any,
  options: any,
  path: string | undefined,
  hostname: string | undefined,
  tls: any,
  contexts: Map<string, any> | null,
  onListen: ((...args: any[]) => void) | undefined,
) {
  exclusive = !!exclusive;

  if (cluster === undefined) cluster = require("node:cluster") as typeof import("node:cluster") | undefined;

  // Use nullish coalescing for cluster.isPrimary / cluster.isMaster check
  // Cast cluster to any to access potentially missing properties like isPrimary/isMaster
  const isClusterPrimary = (cluster as any)?.isPrimary ?? (cluster as any)?.isMaster;

  if (isClusterPrimary || exclusive) {
    server[kRealListen](path, port, hostname, exclusive, ipv6Only, allowHalfOpen, reusePort, tls, contexts, onListen);
    return;
  }

  const serverQuery = {
    address: address,
    port: port,
    addressType: addressType,
    fd: fd,
    flags,
    backlog,
    ...options,
  };
  (cluster as any)._getServer(server, serverQuery, function listenOnPrimaryHandle(err: number, handle: any) {
    err = checkBindError(err, serverQuery.port, handle);
    if (err) {
      // Pass port as number to ExceptionWithHostPort, handle undefined port
      throw new ExceptionWithHostPort(err as number, "bind", address || hostname || path || "", port ?? 0); // FIX TS2345 (Cast err to number)
    }
    server[kRealListen](path, port, hostname, exclusive, ipv6Only, allowHalfOpen, reusePort, tls, contexts, onListen);
  });
}

function createServer(options?: ServerOpts | ((socket: Socket) => void), connectionListener?: (socket: Socket) => void) {
  return new (Server as any)(options as any, connectionListener);
}

function normalizeArgs(args: unknown[]): [options: Record<PropertyKey, any>, cb: Function | null] {
  while (args.length && args[args.length - 1] == null) args.pop();
  let arr: any[];

  if (args.length === 0) {
    arr = [{}, null];
    (arr as any)[normalizedArgsSymbol] = true;
    return arr as [Record<PropertyKey, any>, Function | null];
  }

  const arg0 = args[0];
  let options: any = {};
  if (typeof arg0 === "object" && arg0 !== null) {
    options = arg0;
  } else if (isPipeName(arg0)) {
    options.path = arg0;
  } else {
    options.port = arg0;
    if (args.length > 1 && typeof args[1] === "string") {
      options.host = args[1];
    }
  }

  const cb = args[args.length - 1];
  if (typeof cb !== "function") arr = [options, null];
  else arr = [options, cb];
  (arr as any)[normalizedArgsSymbol] = true;

  return arr as [Record<PropertyKey, any>, Function | null];
}

function checkBindError(err: number, port: number | undefined, handle: any): number {
  // EADDRINUSE may not be reported until we call listen() or connect().
  // To complicate matters, a failed bind() followed by listen() or connect()
  // will implicitly bind to a random port. Ergo, check that the socket is
  // bound to the expected port before calling listen() or connect().
  if (err === 0 && port !== undefined && port > 0 && handle?.getsockname) {
    const out: { port?: number } = {};
    // Cast handle to Listener to ensure getsockname is available
    // FIX TS2345: Cast result to number
    err = (handle as $ZigGeneratedClasses.Listener).getsockname(out) as number;
    if (err === 0 && port !== out.port) {
      $debug(`checkBindError, bound to ${out.port} instead of ${port}`);
      const UV_EADDRINUSE = -4091; // TODO: Use actual constant
      err = UV_EADDRINUSE;
    }
  }
  return err;
}

function isPipeName(s: unknown): s is string {
  return typeof s === "string" && toNumber(s) === false;
}

function toNumber(x: any): number | false {
  // Cast to number, check if >= 0. If NaN or negative, return false.
  const num = Number(x);
  return num >= 0 ? num : false;
}

// TODO:
class BlockList {
  constructor() {}

  addSubnet(_net: any, _prefix: any, _type: any) {}

  check(_address: any, _type: any) {
    return false;
  }
}

export default {
  createServer,
  Server: Server as any as typeof import("node:net").Server, // Cast to satisfy export type
  createConnection,
  connect,
  isIP,
  isIPv4,
  isIPv6,
  Socket: Socket as any as typeof import("node:net").Socket, // Cast to satisfy export type
  _normalizeArgs: normalizeArgs,

  getDefaultAutoSelectFamily: $zig("node_net_binding.zig", "getDefaultAutoSelectFamily"),
  setDefaultAutoSelectFamily: $zig("node_net_binding.zig", "setDefaultAutoSelectFamily"),
  getDefaultAutoSelectFamilyAttemptTimeout: $zig("node_net_binding.zig", "getDefaultAutoSelectFamilyAttemptTimeout"),
  setDefaultAutoSelectFamilyAttemptTimeout: $zig("node_net_binding.zig", "setDefaultAutoSelectFamilyAttemptTimeout"),

  BlockList,
  SocketAddress,
  // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L2456
  Stream: Socket as any as typeof import("node:net").Socket, // Cast to satisfy export type
} as any as typeof import("node:net");