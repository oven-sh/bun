var {isTypedArray } = require("node:util/types");
var parseCertString = function() {
  throwNotImplemented("Not implemented");
}, isValidTLSArray = function(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || obj instanceof ArrayBuffer || obj instanceof Blob)
    return !0;
  if (Array.isArray(obj)) {
    for (var i = 0;i < obj.length; i++)
      if (typeof obj !== "string" && !isTypedArray(obj) && !(obj instanceof ArrayBuffer) && !(obj instanceof Blob))
        return !1;
    return !0;
  }
}, SecureContext = function(options) {
  return new InternalSecureContext(options);
}, createSecureContext = function(options) {
  return new SecureContext(options);
}, createServer = function(options, connectionListener) {
  return new Server(options, connectionListener);
}, InternalSecureContext = class SecureContext2 {
  context;
  constructor(options) {
    const context = {};
    if (options) {
      let key = options.key;
      if (key) {
        if (!isValidTLSArray(key))
          throw new TypeError("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        this.key = key;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert))
          throw new TypeError("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        this.cert = cert;
      }
      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca))
          throw new TypeError("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        this.ca = ca;
      }
      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string")
        throw new TypeError("passphrase argument must be an string");
      this.passphrase = passphrase;
      let servername = options.servername;
      if (servername && typeof servername !== "string")
        throw new TypeError("servername argument must be an string");
      this.servername = servername;
      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number")
        throw new TypeError("secureOptions argument must be an number");
      this.secureOptions = secureOptions;
    }
    this.context = context;
  }
}, { [Symbol.for("::bunternal::")]: InternalTCPSocket, Server: NetServer } = import.meta.require("net"), buntls = Symbol.for("::buntls::"), SocketClass, TLSSocket = function(InternalTLSSocket) {
  return SocketClass = InternalTLSSocket, Object.defineProperty(SocketClass.prototype, Symbol.toStringTag, {
    value: "TLSSocket",
    enumerable: !1
  }), Object.defineProperty(function Socket(options) {
    return new InternalTLSSocket(options);
  }, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalTLSSocket;
    }
  });
}(class TLSSocket2 extends InternalTCPSocket {
  #secureContext;
  constructor(options) {
    super(options);
    this.#secureContext = options.secureContext || createSecureContext(options), this.authorized = !1, this.secureConnecting = !0, this._secureEstablished = !1, this._securePending = !0;
  }
  _secureEstablished = !1;
  _securePending = !0;
  _newSessionPending;
  _controlReleased;
  secureConnecting = !1;
  _SNICallback;
  servername;
  alpnProtocol;
  authorized = !1;
  authorizationError;
  encrypted = !0;
  exportKeyingMaterial() {
    throw Error("Not implented in Bun yet");
  }
  setMaxSendFragment() {
    throw Error("Not implented in Bun yet");
  }
  setServername() {
    throw Error("Not implented in Bun yet");
  }
  setSession() {
    throw Error("Not implented in Bun yet");
  }
  getPeerCertificate() {
    throw Error("Not implented in Bun yet");
  }
  getCertificate() {
    throw Error("Not implented in Bun yet");
  }
  getPeerX509Certificate() {
    throw Error("Not implented in Bun yet");
  }
  getX509Certificate() {
    throw Error("Not implented in Bun yet");
  }
  [buntls](port, host) {
    var { servername } = this;
    if (servername)
      return {
        serverName: typeof servername === "string" ? servername : host,
        ...this.#secureContext
      };
    return !0;
  }
});

class Server extends NetServer {
  key;
  cert;
  ca;
  passphrase;
  secureOptions;
  _rejectUnauthorized;
  _requestCert;
  servername;
  constructor(options, secureConnectionListener) {
    super(options, secureConnectionListener);
    this.setSecureContext(options);
  }
  emit(event, args) {
    if (super.emit(event, args), event === "connection")
      args.once("secureConnect", () => {
        super.emit("secureConnection", args);
      });
  }
  setSecureContext(options) {
    if (options instanceof InternalSecureContext)
      options = options.context;
    if (options) {
      let key = options.key;
      if (key) {
        if (!isValidTLSArray(key))
          throw new TypeError("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        this.key = key;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert))
          throw new TypeError("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        this.cert = cert;
      }
      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca))
          throw new TypeError("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        this.ca = ca;
      }
      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string")
        throw new TypeError("passphrase argument must be an string");
      this.passphrase = passphrase;
      let servername = options.servername;
      if (servername && typeof servername !== "string")
        throw new TypeError("servername argument must be an string");
      this.servername = servername;
      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number")
        throw new TypeError("secureOptions argument must be an number");
      this.secureOptions = secureOptions;
      const requestCert = options.requestCert || !1;
      if (requestCert)
        this._requestCert = requestCert;
      else
        this._requestCert = void 0;
      const rejectUnauthorized = options.rejectUnauthorized || !1;
      if (rejectUnauthorized)
        this._rejectUnauthorized = rejectUnauthorized;
      else
        this._rejectUnauthorized = void 0;
    }
  }
  getTicketKeys() {
    throw Error("Not implented in Bun yet");
  }
  setTicketKeys() {
    throw Error("Not implented in Bun yet");
  }
  [buntls](port, host, isClient) {
    return [
      {
        serverName: this.servername || host || "localhost",
        key: this.key,
        cert: this.cert,
        ca: this.ca,
        passphrase: this.passphrase,
        secureOptions: this.secureOptions,
        rejectUnauthorized: isClient ? !1 : this._rejectUnauthorized,
        requestCert: isClient ? !1 : this._requestCert
      },
      SocketClass
    ];
  }
}
var CLIENT_RENEG_LIMIT = 3, CLIENT_RENEG_WINDOW = 600, DEFAULT_ECDH_CURVE = "auto", DEFAULT_CIPHERS = "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256", DEFAULT_MIN_VERSION = "TLSv1.2", DEFAULT_MAX_VERSION = "TLSv1.3", createConnection = (port, host, connectListener) => {
  if (typeof port === "object")
    return new TLSSocket(port).connect(port, host, connectListener);
  return new TLSSocket().connect(port, host, connectListener);
}, connect = createConnection, exports = {
  createSecureContext,
  parseCertString,
  getCiphers() {
    return DEFAULT_CIPHERS.split(":");
  },
  getCurves() {
    return;
  },
  convertALPNProtocols(protocols, out) {
  },
  TLSSocket,
  SecureContext,
  CLIENT_RENEG_LIMIT,
  CLIENT_RENEG_WINDOW,
  DEFAULT_ECDH_CURVE,
  DEFAULT_CIPHERS,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
  [Symbol.for("CommonJS")]: 0,
  connect,
  createConnection,
  Server,
  createServer
}, tls_default = exports;
export {
  parseCertString,
  tls_default as default,
  createSecureContext,
  createConnection,
  connect,
  TLSSocket,
  SecureContext,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
  DEFAULT_ECDH_CURVE,
  DEFAULT_CIPHERS,
  CLIENT_RENEG_WINDOW,
  CLIENT_RENEG_LIMIT
};

//# debugId=79E8EFC6EC55A55C64756e2164756e21
