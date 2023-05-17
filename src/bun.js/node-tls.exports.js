function parseCertString() {
  throw Error("Not implemented");
}

function mapStringArray(item) {
  return item.toString();
}

var InternalSecureContext = class SecureContext {
  context;

  constructor(options) {
    const context = {};
    if (options) {
      if (typeof options.servername === "string" && options.servername.length > 0) {
        this.servername = options.servername;
      }
      if (options.key) {
        context.key = (Array.isArray(options.key) ? options.key : [options.key]).map(mapStringArray);
      } else context.key = undefined;

      if (options.passphrase) context.passphrase = options.passphrase;
      else context.passphrase = undefined;

      if (options.cert) {
        context.cert = (Array.isArray(options.cert) ? options.cert : [options.cert]).map(mapStringArray);
      } else context.cert = undefined;

      if (options.ca) {
        context.ca = (Array.isArray(options.ca) ? options.ca : [options.ca]).map(mapStringArray);
      } else context.ca = undefined;

      const secureOptions = options.secureOptions || 0;

      if (secureOptions) context.secureOptions = secureOptions;
      else context.secureOptions = undefined;
    }
    this.context = context;
  }
};

function SecureContext(options) {
  return new InternalSecureContext(options);
}

function createSecureContext(options) {
  return new SecureContext(options);
}

const { [Symbol.for("::bunternal::")]: InternalTCPSocket, Server: NetServer } = import.meta.require("net");

const buntls = Symbol.for("::buntls::");

var SocketClass;
const TLSSocket = (function (InternalTLSSocket) {
  SocketClass = InternalTLSSocket;
  Object.defineProperty(SocketClass.prototype, Symbol.toStringTag, {
    value: "TLSSocket",
    enumerable: false,
  });

  return Object.defineProperty(
    function Socket(options) {
      return new InternalTLSSocket(options);
    },
    Symbol.hasInstance,
    {
      value(instance) {
        return instance instanceof InternalTLSSocket;
      },
    },
  );
})(
  class TLSSocket extends InternalTCPSocket {
    #secureContext;
    constructor(options) {
      super(options);
      this.#secureContext = options.secureContext || createSecureContext(options);
      this.authorized = false;
      this.secureConnecting = true;
      this._secureEstablished = false;
      this._securePending = true;
    }

    _secureEstablished = false;
    _securePending = true;
    _newSessionPending;
    _controlReleased;
    secureConnecting = false;
    _SNICallback;
    servername;
    alpnProtocol;
    authorized = false;
    authorizationError;

    encrypted = true;

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
      if (servername) {
        return {
          serverName: typeof servername === "string" ? servername : host,
          ...this.#secureContext,
        };
      }

      return true;
    }
  },
);

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
    super.emit(event, args);

    if (event === "connection") {
      // grabs secureConnect to emit secureConnection
      args.once("secureConnect", () => {
        super.emit("secureConnection", args);
      });
    }
  }
  setSecureContext(options) {
    if (options instanceof InternalSecureContext) {
      options = options.context;
    }
    if (options) {
      if (typeof options.servername === "string" && options.servername.length > 0) {
        this.servername = options.servername;
      }
      if (options.key) {
        this.key = (Array.isArray(options.key) ? options.key : [options.key]).map(mapStringArray);
      } else this.key = undefined;

      if (options.passphrase) this.passphrase = options.passphrase;
      else this.passphrase = undefined;

      if (options.cert) {
        this.cert = (Array.isArray(options.cert) ? options.cert : [options.cert]).map(mapStringArray);
      } else this.cert = undefined;

      if (options.ca) {
        this.ca = (Array.isArray(options.ca) ? options.ca : [options.ca]).map(mapStringArray);
      } else this.ca = undefined;

      const secureOptions = options.secureOptions || 0;

      if (secureOptions) this.secureOptions = secureOptions;
      else this.secureOptions = undefined;

      const requestCert = options.requestCert || false;

      if (requestCert) this._requestCert = requestCert;
      else this._requestCert = undefined;

      const rejectUnauthorized = options.rejectUnauthorized || false;

      if (rejectUnauthorized) {
        this._rejectUnauthorized = rejectUnauthorized;
      } else this._rejectUnauthorized = undefined;
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
        // Client always is NONE on set_verify
        rejectUnauthorized: isClient ? false : this._rejectUnauthorized,
        requestCert: isClient ? false : this._requestCert,
      },
      SocketClass,
    ];
  }
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}
export const CLIENT_RENEG_LIMIT = 3,
  CLIENT_RENEG_WINDOW = 600,
  DEFAULT_ECDH_CURVE = "auto",
  // https://github.com/Jarred-Sumner/uSockets/blob/fafc241e8664243fc0c51d69684d5d02b9805134/src/crypto/openssl.c#L519-L523
  DEFAULT_CIPHERS =
    "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256",
  DEFAULT_MIN_VERSION = "TLSv1.2",
  DEFAULT_MAX_VERSION = "TLSv1.3",
  createConnection = (port, host, connectListener) => {
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

    return new TLSSocket(options).connect(options, connectListener);
  },
  connect = createConnection;

var exports = {
  createSecureContext,
  parseCertString,

  getCiphers() {
    return DEFAULT_CIPHERS.split(":");
  },

  getCurves() {
    return;
  },

  convertALPNProtocols(protocols, out) {},
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
  createServer,
};

export default exports;

export { createSecureContext, parseCertString, TLSSocket, SecureContext };
