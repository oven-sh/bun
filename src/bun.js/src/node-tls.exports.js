function parseCertString() {
  throw Error("Not implemented");
}

var InternalSecureContext = class SecureContext {};
function SecureContext() {
  return new InternalSecureContext();
}

function createSecureContext(options) {
  return new SecureContext();
}

const { [Symbol.for("::bunternal::")]: InternalTCPSocket } = import.meta.require("net");

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
    constructor(options) {
      super(options);
    }

    _secureEstablished = false;
    _securePending = true;
    _newSessionPending;
    _controlReleased;
    secureConnecting = false;
    _SNICallback;
    servername;
    alpnProtocol;
    authorized = true;
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

    emit(event, args) {
      super.emit(event, args);

      if (event === "connect" && !this._readableState?.destroyed) {
        this.authorized = true;
        this.secureConnecting = false;
        this._secureEstablished = true;
        this._securePending = false;

        super.emit("secureConnect", args);
      }
    }

    [buntls](port, host) {
      var { servername } = this;
      if (servername) {
        return {
          serverName: typeof servername === "string" ? servername : host,
        };
      }

      return true;
    }
  },
);
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
};

export default exports;

export { createSecureContext, parseCertString, TLSSocket, SecureContext };
