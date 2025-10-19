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
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE

// USE OR OTHER DEALINGS IN THE SOFTWARE.
const Duplex = require("internal/streams/duplex");
const { getDefaultHighWaterMark } = require("internal/streams/state");
const EventEmitter = require("node:events");
let dns: typeof import("node:dns");

const normalizedArgsSymbol = Symbol("normalizedArgs");
const { ExceptionWithHostPort } = require("internal/shared");
import type { Socket, SocketHandler, SocketListener } from "bun";
import type { Server as NetServer, Socket as NetSocket, ServerOpts } from "node:net";
import type { TLSSocket } from "node:tls";
const { kTimeout, getTimerDuration } = require("internal/timers");
const { validateFunction, validateNumber, validateAbortSignal, validatePort, validateBoolean, validateInt32, validateString } = require("internal/validators"); // prettier-ignore
const { NodeAggregateError, ErrnoException } = require("internal/shared");

const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypePush = Array.prototype.push;
const MathMax = Math.max;

const { UV_ECANCELED, UV_ETIMEDOUT } = process.binding("uv");
const isWindows = process.platform === "win32";

const getDefaultAutoSelectFamily = $zig("node_net_binding.zig", "getDefaultAutoSelectFamily");
const setDefaultAutoSelectFamily = $zig("node_net_binding.zig", "setDefaultAutoSelectFamily");
const getDefaultAutoSelectFamilyAttemptTimeout = $zig("node_net_binding.zig", "getDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore
const setDefaultAutoSelectFamilyAttemptTimeout = $zig("node_net_binding.zig", "setDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore
const SocketAddress = $zig("node_net_binding.zig", "SocketAddress");
const BlockList = $zig("node_net_binding.zig", "BlockList");
const newDetachedSocket = $newZigFunction("node_net_binding.zig", "newDetachedSocket", 1);
const doConnect = $newZigFunction("node_net_binding.zig", "doConnect", 2);

const addServerName = $newZigFunction("Listener.zig", "jsAddServerName", 3);
const upgradeDuplexToTLS = $newZigFunction("socket.zig", "jsUpgradeDuplexToTLS", 2);
const isNamedPipeSocket = $newZigFunction("socket.zig", "jsIsNamedPipeSocket", 1);
const getBufferedAmount = $newZigFunction("socket.zig", "jsGetBufferedAmount", 1);

// IPv4 Segment
const v4Seg = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
const v4Str = `(?:${v4Seg}\\.){3}${v4Seg}`;
var IPv4Reg;

// IPv6 Segment
const v6Seg = "(?:[0-9a-fA-F]{1,4})";
var IPv6Reg;

function isIPv4(s): boolean {
  return (IPv4Reg ??= new RegExp(`^${v4Str}$`)).test(s);
}

function isIPv6(s): boolean {
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

function isIP(s): 0 | 4 | 6 {
  if (isIPv4(s)) return 4;
  if (isIPv6(s)) return 6;
  return 0;
}

const bunTlsSymbol = Symbol.for("::buntls::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");
const owner_symbol = Symbol("owner_symbol");

const kServerSocket = Symbol("kServerSocket");
const kBytesWritten = Symbol("kBytesWritten");
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
const kReinitializeHandle = Symbol("kReinitializeHandle");

const kRealListen = Symbol("kRealListen");
const kSetNoDelay = Symbol("kSetNoDelay");
const kSetKeepAlive = Symbol("kSetKeepAlive");
const kSetKeepAliveInitialDelay = Symbol("kSetKeepAliveInitialDelay");
const kConnectOptions = Symbol("connect-options");
const kAttach = Symbol("kAttach");
const kCloseRawConnection = Symbol("kCloseRawConnection");
const kpendingRead = Symbol("kpendingRead");
const kupgraded = Symbol("kupgraded");
const ksocket = Symbol("ksocket");
const khandlers = Symbol("khandlers");
const kclosed = Symbol("closed");
const kended = Symbol("ended");
const kwriteCallback = Symbol("writeCallback");
const kSocketClass = Symbol("kSocketClass");

function endNT(socket, callback, err) {
  socket.$end();
  callback(err);
}
function emitCloseNT(self, hasError) {
  self.emit("close", hasError);
}
function detachSocket(self) {
  if (!self) self = this;
  self._handle = null;
}
function destroyNT(self, err) {
  self.destroy(err);
}
function destroyWhenAborted(err) {
  if (!this.destroyed) {
    this.destroy(err.target.reason);
  }
}
// in node's code this callback is called 'onReadableStreamEnd' but that seemed confusing when `ReadableStream`s now exist
function onSocketEnd() {
  if (!this.allowHalfOpen) {
    this.write = writeAfterFIN;
  }
}
// Provide a better error message when we call end() as a result
// of the other side sending a FIN.  The standard 'write after end'
// is overly vague, and makes it seem like the user's code is to blame.
function writeAfterFIN(chunk, encoding, cb) {
  if (!this.writableEnded) {
    return Duplex.prototype.write.$call(this, chunk, encoding, cb);
  }

  if (typeof encoding === "function") {
    cb = encoding;
    encoding = null;
  }

  const err = new Error("This socket has been ended by the other party");
  err.code = "EPIPE";
  if (typeof cb === "function") {
    process.nextTick(cb, err);
  }
  this.destroy(err);

  return false;
}
function onConnectEnd() {
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

const { Socket } = require("internal/net/socket");
const { Server } = require("internal/net/server");


function createConnection(...args) {
  const normalized = normalizeArgs(args);
  const options = normalized[0];
  const socket = new Socket(options);

  if (options.timeout) {
    socket.setTimeout(options.timeout);
  }

  return socket.connect(normalized);
}

function lookupAndConnect(self, options) {
  const { localAddress, localPort } = options;
  const host = options.host || "localhost";
  let { port, autoSelectFamilyAttemptTimeout, autoSelectFamily } = options;

  validateString(host, "options.host");

  if (localAddress && !isIP(localAddress)) {
    throw $ERR_INVALID_IP_ADDRESS(localAddress);
  }
  if (localPort) {
    validateNumber(localPort, "options.localPort");
  }
  if (typeof port !== "undefined") {
    if (typeof port !== "number" && typeof port !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.port", ["number", "string"], port);
    }
    validatePort(port);
  }
  port |= 0;

  if (autoSelectFamily != null) {
    validateBoolean(autoSelectFamily, "options.autoSelectFamily");
  } else {
    autoSelectFamily = getDefaultAutoSelectFamily();
  }

  if (autoSelectFamilyAttemptTimeout != null) {
    validateInt32(autoSelectFamilyAttemptTimeout, "options.autoSelectFamilyAttemptTimeout", 1);

    if (autoSelectFamilyAttemptTimeout < 10) {
      autoSelectFamilyAttemptTimeout = 10;
    }
  } else {
    autoSelectFamilyAttemptTimeout = getDefaultAutoSelectFamilyAttemptTimeout();
  }

  // If host is an IP, skip performing a lookup
  const addressType = isIP(host);
  if (addressType) {
    process.nextTick(() => {
      if (self.connecting) {
        internalConnect(self, options, host, port, addressType, localAddress, localPort);
      }
    });
    return;
  }

  if (options.lookup != null) validateFunction(options.lookup, "options.lookup");

  if (dns === undefined) dns = require("node:dns");
  const dnsopts = {
    family: socketToDnsFamily(options.family),
    hints: options.hints || 0,
  };
  if (!isWindows && dnsopts.family !== 4 && dnsopts.family !== 6 && dnsopts.hints === 0) {
    dnsopts.hints = dns.ADDRCONFIG;
  }

  $debug("connect: find host", host, addressType);
  $debug("connect: dns options", dnsopts);
  self._host = host;
  self._port = port;
  const lookup = options.lookup || dns.lookup;

  if (dnsopts.family !== 4 && dnsopts.family !== 6 && !localAddress && autoSelectFamily) {
    $debug("connect: autodetecting", host, port);

    dnsopts.all = true;
    lookupAndConnectMultiple(
      self,
      lookup,
      host,
      options,
      dnsopts,
      port,
      localAddress,
      localPort,
      autoSelectFamilyAttemptTimeout,
    );
    return;
  }

  lookup(host, dnsopts, function emitLookup(err, ip, addressType) {
    self.emit("lookup", err, ip, addressType, host);
    if (!self.connecting) return;
    if (err) {
      process.nextTick(destroyNT, self, err);
    } else if (!isIP(ip)) {
      err = $ERR_INVALID_IP_ADDRESS(ip);
      process.nextTick(destroyNT, self, err);
    } else if (addressType !== 4 && addressType !== 6) {
      err = $ERR_INVALID_ADDRESS_FAMILY(addressType, options.host, options.port);
      process.nextTick(destroyNT, self, err);
    } else {
      self._unrefTimer();
      internalConnect(self, options, ip, port, addressType, localAddress, localPort);
    }
  });
}

function socketToDnsFamily(family) {
  switch (family) {
    case "IPv4": return 4; // prettier-ignore
    case "IPv6": return 6; // prettier-ignore
  }
  return family;
}

function lookupAndConnectMultiple(self, lookup, host, options, dnsopts, port, localAddress, localPort, timeout) {
  lookup(host, dnsopts, function emitLookup(err, addresses) {
    if (!self.connecting) {
      return;
    } else if (err) {
      self.emit("lookup", err, undefined, undefined, host);
      process.nextTick(destroyNT, self, err);
      return;
    }

    const validAddresses = [[], []];
    const validIps = [[], []];
    let destinations;
    for (let i = 0, l = addresses.length; i < l; i++) {
      const address = addresses[i];
      const { address: ip, family: addressType } = address;
      self.emit("lookup", err, ip, addressType, host);
      if (!self.connecting) {
        return;
      }
      if (isIP(ip) && (addressType === 4 || addressType === 6)) {
        destinations ||= addressType === 6 ? { 6: 0, 4: 1 } : { 4: 0, 6: 1 };

        const destination = destinations[addressType];

        // Only try an address once
        if (!ArrayPrototypeIncludes.$call(validIps[destination], ip)) {
          ArrayPrototypePush.$call(validAddresses[destination], address);
          ArrayPrototypePush.$call(validIps[destination], ip);
        }
      }
    }

    // When no AAAA or A records are available, fail on the first one
    if (!validAddresses[0].length && !validAddresses[1].length) {
      const { address: firstIp, family: firstAddressType } = addresses[0];

      if (!isIP(firstIp)) {
        err = $ERR_INVALID_IP_ADDRESS(firstIp);
        process.nextTick(destroyNT, self, err);
      } else if (firstAddressType !== 4 && firstAddressType !== 6) {
        err = $ERR_INVALID_ADDRESS_FAMILY(firstAddressType, options.host, options.port);
        process.nextTick(destroyNT, self, err);
      }

      return;
    }

    // Sort addresses alternating families
    const toAttempt = [];
    for (let i = 0, l = MathMax(validAddresses[0].length, validAddresses[1].length); i < l; i++) {
      if (i in validAddresses[0]) {
        ArrayPrototypePush.$call(toAttempt, validAddresses[0][i]);
      }
      if (i in validAddresses[1]) {
        ArrayPrototypePush.$call(toAttempt, validAddresses[1][i]);
      }
    }

    if (toAttempt.length === 1) {
      $debug("connect/multiple: only one address found, switching back to single connection");
      const { address: ip, family: addressType } = toAttempt[0];

      self._unrefTimer();
      internalConnect(self, options, ip, port, addressType, localAddress, localPort);

      return;
    }

    self.autoSelectFamilyAttemptedAddresses = [];
    $debug("connect/multiple: will try the following addresses", toAttempt);

    const context = {
      socket: self,
      addresses: toAttempt,
      current: 0,
      port,
      localPort,
      timeout,
      [kTimeout]: null,
      errors: [],
      options,
    };

    self._unrefTimer();
    internalConnectMultiple(context);
  });
}

function internalConnect(self, options, path);
function internalConnect(self, options, address, port, addressType, localAddress, localPort, _flags?) {
  $assert(self.connecting);

  let err;

  if (localAddress || localPort) {
    if (addressType === 4) {
      localAddress ||= "0.0.0.0";
      // TODO:
      // err = self._handle.bind(localAddress, localPort);
    } else {
      // addressType === 6
      localAddress ||= "::";
      // TODO:
      // err = self._handle.bind6(localAddress, localPort, flags);
    }
    $debug(
      "connect: binding to localAddress: %s and localPort: %d (addressType: %d)",
      localAddress,
      localPort,
      addressType,
    );

    err = checkBindError(err, localPort, self._handle);
    if (err) {
      const ex = new ExceptionWithHostPort(err, "bind", localAddress, localPort);
      self.destroy(ex);
      return;
    }
  }

  //TLS
  let connection = self[ksocket];
  if (options.socket) {
    connection = options.socket;
  }
  let tls = undefined;
  const bunTLS = self[bunTlsSymbol];
  if (typeof bunTLS === "function") {
    tls = bunTLS.$call(self, port, self._host, true);
    self._requestCert = true; // Client always request Cert
    if (tls) {
      const { rejectUnauthorized, session, checkServerIdentity } = options;
      if (typeof rejectUnauthorized !== "undefined") {
        self._rejectUnauthorized = rejectUnauthorized;
        tls.rejectUnauthorized = rejectUnauthorized;
      } else {
        self._rejectUnauthorized = tls.rejectUnauthorized;
      }
      tls.requestCert = true;
      tls.session = session || tls.session;
      self.servername = tls.servername;
      tls.checkServerIdentity = checkServerIdentity || tls.checkServerIdentity;
      self[bunTLSConnectOptions] = tls;
      if (!connection && tls.socket) {
        connection = tls.socket;
      }
    }
    self.authorized = false;
    self.secureConnecting = true;
    self._secureEstablished = false;
    self._securePending = true;
    self[kConnectOptions] = options;
    self.prependListener("end", onConnectEnd);
  }
  //TLS

  $debug("connect: attempting to connect to %s:%d (addressType: %d)", address, port, addressType);
  self.emit("connectionAttempt", address, port, addressType);

  if (addressType === 6 || addressType === 4) {
    if (self.blockList?.check(address, `ipv${addressType}`)) {
      self.destroy($ERR_IP_BLOCKED(address));
      return;
    }
    const req: any = {};
    req.oncomplete = afterConnect;
    req.address = address;
    req.port = port;
    req.localAddress = localAddress;
    req.localPort = localPort;
    req.addressType = addressType;
    req.tls = tls;

    err = kConnectTcp(self, addressType, req, address, port);
  } else {
    const req: any = {};
    req.address = address;
    req.oncomplete = afterConnect;
    req.tls = tls;

    err = kConnectPipe(self, req, address);
  }

  if (err) {
    const ex = new ExceptionWithHostPort(err, "connect", address, port);
    self.destroy(ex);
  }
}

function internalConnectMultiple(context, canceled?) {
  clearTimeout(context[kTimeout]);
  const self = context.socket;

  // We were requested to abort. Stop all operations
  if (self._aborted) {
    return;
  }

  // All connections have been tried without success, destroy with error
  if (canceled || context.current === context.addresses.length) {
    if (context.errors.length === 0) {
      self.destroy($ERR_SOCKET_CONNECTION_TIMEOUT());
      return;
    }

    self.destroy(new NodeAggregateError(context.errors));
    return;
  }

  $assert(self.connecting);

  const current = context.current++;

  if (current > 0) {
    self[kReinitializeHandle](newDetachedSocket(typeof self[bunTlsSymbol] === "function"));
  }

  const { localPort, port, _flags } = context;
  const { address, family: addressType } = context.addresses[current];
  let localAddress;
  let err;

  if (localPort) {
    if (addressType === 4) {
      localAddress = DEFAULT_IPV4_ADDR;
      // TODO:
      // err = self._handle.bind(localAddress, localPort);
    } else {
      // addressType === 6
      localAddress = DEFAULT_IPV6_ADDR;
      // TODO:
      // err = self._handle.bind6(localAddress, localPort, flags);
    }

    $debug(
      "connect/multiple: binding to localAddress: %s and localPort: %d (addressType: %d)",
      localAddress,
      localPort,
      addressType,
    );

    err = checkBindError(err, localPort, self._handle);
    if (err) {
      ArrayPrototypePush.$call(context.errors, new ExceptionWithHostPort(err, "bind", localAddress, localPort));
      internalConnectMultiple(context);
      return;
    }
  }

  if (self.blockList?.check(address, `ipv${addressType}`)) {
    const ex = $ERR_IP_BLOCKED(address);
    ArrayPrototypePush.$call(context.errors, ex);
    self.emit("connectionAttemptFailed", address, port, addressType, ex);
    internalConnectMultiple(context);
    return;
  }

  //TLS
  let connection = self[ksocket];
  if (context.options.socket) {
    connection = context.options.socket;
  }
  let tls = undefined;
  const bunTLS = self[bunTlsSymbol];
  if (typeof bunTLS === "function") {
    tls = bunTLS.$call(self, port, self._host, true);
    self._requestCert = true; // Client always request Cert
    if (tls) {
      const { rejectUnauthorized, session, checkServerIdentity } = context.options;
      if (typeof rejectUnauthorized !== "undefined") {
        self._rejectUnauthorized = rejectUnauthorized;
        tls.rejectUnauthorized = rejectUnauthorized;
      } else {
        self._rejectUnauthorized = tls.rejectUnauthorized;
      }
      tls.requestCert = true;
      tls.session = session || tls.session;
      self.servername = tls.servername;
      tls.checkServerIdentity = checkServerIdentity || tls.checkServerIdentity;
      self[bunTLSConnectOptions] = tls;
      if (!connection && tls.socket) {
        connection = tls.socket;
      }
    }
    self.authorized = false;
    self.secureConnecting = true;
    self._secureEstablished = false;
    self._securePending = true;
    self[kConnectOptions] = context.options;
    self.prependListener("end", onConnectEnd);
  }
  //TLS

  $debug("connect/multiple: attempting to connect to %s:%d (addressType: %d)", address, port, addressType);
  self.emit("connectionAttempt", address, port, addressType);

  // const req = new TCPConnectWrap();
  const req = {};
  req.oncomplete = afterConnectMultiple.bind(undefined, context, current);
  req.address = address;
  req.port = port;
  req.localAddress = localAddress;
  req.localPort = localPort;
  req.addressType = addressType;
  req.tls = tls;

  ArrayPrototypePush.$call(self.autoSelectFamilyAttemptedAddresses, `${address}:${port}`);

  err = kConnectTcp(self, addressType, req, address, port);

  if (err) {
    const ex = new ExceptionWithHostPort(err, "connect", address, port);
    ArrayPrototypePush.$call(context.errors, ex);

    self.emit("connectionAttemptFailed", address, port, addressType, ex);
    internalConnectMultiple(context);
    return;
  }

  if (current < context.addresses.length - 1) {
    $debug("connect/multiple: setting the attempt timeout to %d ms", context.timeout);

    // If the attempt has not returned an error, start the connection timer
    context[kTimeout] = setTimeout(internalConnectMultipleTimeout, context.timeout, context, req, self._handle).unref();
  }
}

function internalConnectMultipleTimeout(context, req, handle) {
  $debug("connect/multiple: connection to %s:%s timed out", req.address, req.port);
  context.socket.emit("connectionAttemptTimeout", req.address, req.port, req.addressType);

  req.oncomplete = undefined;
  ArrayPrototypePush.$call(context.errors, createConnectionError(req, UV_ETIMEDOUT));
  handle.close();

  // Try the next address, unless we were aborted
  if (context.socket.connecting) {
    internalConnectMultiple(context);
  }
}

function afterConnect(status, handle, req, readable, writable) {
  if (!handle) return;
  const self = handle[owner_symbol];
  if (!self) return;

  // Callback may come after call to destroy
  if (self.destroyed) {
    return;
  }

  $debug("afterConnect", status, readable, writable);

  $assert(self.connecting);
  self.connecting = false;
  self._sockname = null;

  if (status === 0) {
    if (self.readable && !readable) {
      self.push(null);
      self.read();
    }
    if (self.writable && !writable) {
      self.end();
    }
    self._unrefTimer();

    if (self[kSetNoDelay] && self._handle.setNoDelay) {
      self._handle.setNoDelay(true);
    }

    if (self[kSetKeepAlive] && self._handle.setKeepAlive) {
      self._handle.setKeepAlive(true, self[kSetKeepAliveInitialDelay]);
    }

    self.emit("connect");
    self.emit("ready");

    // Start the first read, or get an immediate EOF.
    // this doesn't actually consume any bytes, because len=0.
    if (readable && !self.isPaused()) self.read(0);
  } else {
    let details;
    if (req.localAddress && req.localPort) {
      details = req.localAddress + ":" + req.localPort;
    }
    const ex = new ExceptionWithHostPort(status, "connect", req.address, req.port);
    if (details) {
      ex.localAddress = req.localAddress;
      ex.localPort = req.localPort;
    }

    self.emit("connectionAttemptFailed", req.address, req.port, req.addressType, ex);
    self.destroy(ex);
  }
}

function afterConnectMultiple(context, current, status, handle, req, readable, writable) {
  $debug("connect/multiple: connection attempt to %s:%s completed with status %s", req.address, req.port, status);

  // Make sure another connection is not spawned
  $debug("clearTimeout", context[kTimeout]);
  clearTimeout(context[kTimeout]);

  // One of the connection has completed and correctly dispatched but after timeout, ignore this one
  if (status === 0 && current !== context.current - 1) {
    $debug("connect/multiple: ignoring successful but timedout connection to %s:%s", req.address, req.port);
    handle.close();
    return;
  }

  const self = context.socket;

  // Some error occurred, add to the list of exceptions
  if (status !== 0) {
    const ex = createConnectionError(req, status);
    ArrayPrototypePush.$call(context.errors, ex);

    self.emit("connectionAttemptFailed", req.address, req.port, req.addressType, ex);

    // Try the next address, unless we were aborted
    if (context.socket.connecting) {
      internalConnectMultiple(context, status === UV_ECANCELED);
    }

    return;
  }

  afterConnect(status, self._handle, req, readable, writable);
}

function createConnectionError(req, status) {
  let details;

  if (req.localAddress && req.localPort) {
    details = req.localAddress + ":" + req.localPort;
  }

  const ex = new ExceptionWithHostPort(status, "connect", req.address, req.port);
  if (details) {
    ex.localAddress = req.localAddress;
    ex.localPort = req.localPort;
  }

  return ex;
}

type MaybeListener = SocketListener<unknown> | null;

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}

function normalizeArgs(args: unknown[]): [options: Record<PropertyKey, any>, cb: Function | null] {
  // while (args.length && args[args.length - 1] == null) args.pop();
  let arr;

  if (args.length === 0) {
    arr = [{}, null];
    arr[normalizedArgsSymbol as symbol] = true;
    return arr;
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
  arr[normalizedArgsSymbol as symbol] = true;

  return arr;
}

// Called when creating new Socket, or when re-using a closed Socket
function initSocketHandle(self) {
  self._undestroy();
  self._sockname = null;
  self[kclosed] = false;
  self[kended] = false;

  // Handle creation may be deferred to bind() or connect() time.
  if (self._handle) {
    self._handle[owner_symbol] = self;
  }
}

function closeSocketHandle(self, isException, isCleanupPending = false) {
  $debug("closeSocketHandle", isException, isCleanupPending, !!self._handle);
  if (self._handle) {
    self._handle.close();
    setImmediate(() => {
      $debug("emit close", isCleanupPending);
      self.emit("close", isException);
      if (isCleanupPending) {
        self._handle.onread = () => {};
        self._handle = null;
        self._sockname = null;
      }
    });
  }
}

function checkBindError(err, port, handle) {
  // EADDRINUSE may not be reported until we call listen() or connect().
  // To complicate matters, a failed bind() followed by listen() or connect()
  // will implicitly bind to a random port. Ergo, check that the socket is
  // bound to the expected port before calling listen() or connect().
  if (err === 0 && port > 0 && handle.getsockname) {
    const out = {};
    err = handle.getsockname(out);
    if (err === 0 && port !== out.port) {
      $debug(`checkBindError, bound to ${out.port} instead of ${port}`);
      const UV_EADDRINUSE = -4091;
      err = UV_EADDRINUSE;
    }
  }
  return err;
}

function isPipeName(s) {
  return typeof s === "string" && toNumber(s) === false;
}

function toNumber(x) {
  return (x = Number(x)) >= 0 ? x : false;
}

let warnSimultaneousAccepts = true;
function _setSimultaneousAccepts() {
  if (warnSimultaneousAccepts) {
    process.emitWarning(
      "net._setSimultaneousAccepts() is deprecated and will be removed.",
      "DeprecationWarning",
      "DEP0121",
    );
    warnSimultaneousAccepts = false;
  }
}

export default {
  createServer,
  Server,
  createConnection,
  connect: createConnection,
  isIP,
  isIPv4,
  isIPv6,
  Socket,
  _normalizeArgs: normalizeArgs,
  _setSimultaneousAccepts,

  getDefaultAutoSelectFamily,
  setDefaultAutoSelectFamily,
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamilyAttemptTimeout,

  BlockList,
  SocketAddress,
  // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L2456
  Stream: Socket,
} as any as typeof import("node:net");
