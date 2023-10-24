var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/tls.js


// Hardcoded module "node:tls"
const { isArrayBufferView, isTypedArray } = (__intrinsic__requireNativeModule("util/types"));
const net = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 27/*node:net*/) || __intrinsic__createInternalModuleById(27/*node:net*/));
const { Server: NetServer, [Symbol.for("::bunternal::")]: InternalTCPSocket } = net;
const bunSocketInternal = Symbol.for("::bunnetsocketinternal::");
const { rootCertificates, canonicalizeIP } = __intrinsic__lazy("internal/tls");

const SymbolReplace = Symbol.replace;
const RegExpPrototypeSymbolReplace = RegExp.prototype[SymbolReplace];
const RegExpPrototypeExec = RegExp.prototype.exec;

const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSubstring = String.prototype.substring;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringFromCharCode = String.fromCharCode;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;

const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeForEach = Array.prototype.forEach;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSome = Array.prototype.some;
const ArrayPrototypeReduce = Array.prototype.reduce;
function parseCertString() {
  // Removed since JAN 2022 Node v18.0.0+ https://github.com/nodejs/node/pull/41479
  throwNotImplemented("Not implemented");
}

function isValidTLSArray(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || obj instanceof ArrayBuffer || obj instanceof Blob) return true;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      if (typeof obj !== "string" && !isTypedArray(obj) && !(obj instanceof ArrayBuffer) && !(obj instanceof Blob))
        return false;
    }
    return true;
  }
}

function unfqdn(host) {
  return RegExpPrototypeSymbolReplace.__intrinsic__call(/[.]$/, host, "");
}
// String#toLowerCase() is locale-sensitive so we use
// a conservative version that only lowercases A-Z.
function toLowerCase(c) {
  return StringFromCharCode.__intrinsic__call(32 + StringPrototypeCharCodeAt.__intrinsic__call(c, 0));
}

function splitHost(host) {
  return StringPrototypeSplit.__intrinsic__call(RegExpPrototypeSymbolReplace.__intrinsic__call(/[A-Z]/g, unfqdn(host), toLowerCase), ".");
}

function check(hostParts, pattern, wildcards) {
  // Empty strings, null, undefined, etc. never match.
  if (!pattern) return false;

  const patternParts = splitHost(pattern);

  if (hostParts.length !== patternParts.length) return false;

  // Pattern has empty components, e.g. "bad..example.com".
  if (ArrayPrototypeIncludes.__intrinsic__call(patternParts, "")) return false;

  // RFC 6125 allows IDNA U-labels (Unicode) in names but we have no
  // good way to detect their encoding or normalize them so we simply
  // reject them.  Control characters and blanks are rejected as well
  // because nothing good can come from accepting them.
  const isBad = s => RegExpPrototypeExec.__intrinsic__call(/[^\u0021-\u007F]/u, s) !== null;
  if (ArrayPrototypeSome.__intrinsic__call(patternParts, isBad)) return false;

  // Check host parts from right to left first.
  for (let i = hostParts.length - 1; i > 0; i -= 1) {
    if (hostParts[i] !== patternParts[i]) return false;
  }

  const hostSubdomain = hostParts[0];
  const patternSubdomain = patternParts[0];
  const patternSubdomainParts = StringPrototypeSplit.__intrinsic__call(patternSubdomain, "*");

  // Short-circuit when the subdomain does not contain a wildcard.
  // RFC 6125 does not allow wildcard substitution for components
  // containing IDNA A-labels (Punycode) so match those verbatim.
  if (patternSubdomainParts.length === 1 || StringPrototypeIncludes.__intrinsic__call(patternSubdomain, "xn--"))
    return hostSubdomain === patternSubdomain;

  if (!wildcards) return false;

  // More than one wildcard is always wrong.
  if (patternSubdomainParts.length > 2) return false;

  // *.tld wildcards are not allowed.
  if (patternParts.length <= 2) return false;

  const { 0: prefix, 1: suffix } = patternSubdomainParts;

  if (prefix.length + suffix.length > hostSubdomain.length) return false;

  if (!StringPrototypeStartsWith.__intrinsic__call(hostSubdomain, prefix)) return false;

  if (!StringPrototypeEndsWith.__intrinsic__call(hostSubdomain, suffix)) return false;

  return true;
}

// This pattern is used to determine the length of escaped sequences within
// the subject alt names string. It allows any valid JSON string literal.
// This MUST match the JSON specification (ECMA-404 / RFC8259) exactly.
const jsonStringPattern =
  // eslint-disable-next-line no-control-regex
  /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/;

function splitEscapedAltNames(altNames) {
  const result = [];
  let currentToken = "";
  let offset = 0;
  while (offset !== altNames.length) {
    const nextSep = StringPrototypeIndexOf.__intrinsic__call(altNames, ", ", offset);
    const nextQuote = StringPrototypeIndexOf.__intrinsic__call(altNames, '"', offset);
    if (nextQuote !== -1 && (nextSep === -1 || nextQuote < nextSep)) {
      // There is a quote character and there is no separator before the quote.
      currentToken += StringPrototypeSubstring.__intrinsic__call(altNames, offset, nextQuote);
      const match = RegExpPrototypeExec.__intrinsic__call(jsonStringPattern, StringPrototypeSubstring.__intrinsic__call(altNames, nextQuote));
      if (!match) {
        let error = new SyntaxError("ERR_TLS_CERT_ALTNAME_FORMAT: Invalid subject alternative name string");
        error.name = ERR_TLS_CERT_ALTNAME_FORMAT;
        throw error;
      }
      currentToken += JSON.parse(match[0]);
      offset = nextQuote + match[0].length;
    } else if (nextSep !== -1) {
      // There is a separator and no quote before it.
      currentToken += StringPrototypeSubstring.__intrinsic__call(altNames, offset, nextSep);
      ArrayPrototypePush.__intrinsic__call(result, currentToken);
      currentToken = "";
      offset = nextSep + 2;
    } else {
      currentToken += StringPrototypeSubstring.__intrinsic__call(altNames, offset);
      offset = altNames.length;
    }
  }
  ArrayPrototypePush.__intrinsic__call(result, currentToken);
  return result;
}

function checkServerIdentity(hostname, cert) {
  const subject = cert.subject;
  const altNames = cert.subjectaltname;
  const dnsNames = [];
  const ips = [];

  hostname = "" + hostname;

  if (altNames) {
    const splitAltNames = StringPrototypeIncludes.__intrinsic__call(altNames, '"')
      ? splitEscapedAltNames(altNames)
      : StringPrototypeSplit.__intrinsic__call(altNames, ", ");
    ArrayPrototypeForEach.__intrinsic__call(splitAltNames, name => {
      if (StringPrototypeStartsWith.__intrinsic__call(name, "DNS:")) {
        ArrayPrototypePush.__intrinsic__call(dnsNames, StringPrototypeSlice.__intrinsic__call(name, 4));
      } else if (StringPrototypeStartsWith.__intrinsic__call(name, "IP Address:")) {
        ArrayPrototypePush.__intrinsic__call(ips, canonicalizeIP(StringPrototypeSlice.__intrinsic__call(name, 11)));
      }
    });
  }

  let valid = false;
  let reason = "Unknown reason";

  hostname = unfqdn(hostname); // Remove trailing dot for error messages.
  if (net.isIP(hostname)) {
    valid = ArrayPrototypeIncludes.__intrinsic__call(ips, canonicalizeIP(hostname));
    if (!valid) reason = `IP: ${hostname} is not in the cert's list: ` + ArrayPrototypeJoin.__intrinsic__call(ips, ", ");
  } else if (dnsNames.length > 0 || subject?.CN) {
    const hostParts = splitHost(hostname);
    const wildcard = pattern => check(hostParts, pattern, true);

    if (dnsNames.length > 0) {
      valid = ArrayPrototypeSome.__intrinsic__call(dnsNames, wildcard);
      if (!valid) reason = `Host: ${hostname}. is not in the cert's altnames: ${altNames}`;
    } else {
      // Match against Common Name only if no supported identifiers exist.
      const cn = subject.CN;

      if (Array.isArray(cn)) valid = ArrayPrototypeSome.__intrinsic__call(cn, wildcard);
      else if (cn) valid = wildcard(cn);

      if (!valid) reason = `Host: ${hostname}. is not cert's CN: ${cn}`;
    }
  } else {
    reason = "Cert does not contain a DNS name";
  }
  if (!valid) {
    let error = new Error(`ERR_TLS_CERT_ALTNAME_INVALID: Hostname/IP does not match certificate's altnames: ${reason}`);
    error.name = "ERR_TLS_CERT_ALTNAME_INVALID";
    error.reason = reason;
    error.host = hostname;
    error.cert = cert;
    return error;
  }
}

var InternalSecureContext = class SecureContext {
  context;

  constructor(options) {
    const context = {};
    if (options) {
      let key = options.key;
      if (key) {
        if (!isValidTLSArray(key)) {
          __intrinsic__throwTypeError(
            "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.key = key;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert)) {
          __intrinsic__throwTypeError(
            "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.cert = cert;
      }

      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca)) {
          __intrinsic__throwTypeError(
            "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.ca = ca;
      }

      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string") {
        __intrinsic__throwTypeError("passphrase argument must be an string");
      }
      this.passphrase = passphrase;

      let servername = options.servername;
      if (servername && typeof servername !== "string") {
        __intrinsic__throwTypeError("servername argument must be an string");
      }
      this.servername = servername;

      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number") {
        __intrinsic__throwTypeError("secureOptions argument must be an number");
      }
      this.secureOptions = secureOptions;
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

// Translate some fields from the handle's C-friendly format into more idiomatic
// javascript object representations before passing them back to the user.  Can
// be used on any cert object, but changing the name would be semver-major.
function translatePeerCertificate(c) {
  if (!c) return null;

  if (c.issuerCertificate != null && c.issuerCertificate !== c) {
    c.issuerCertificate = translatePeerCertificate(c.issuerCertificate);
  }
  if (c.infoAccess != null) {
    const info = c.infoAccess;
    c.infoAccess = { __proto__: null };
    // XXX: More key validation?
    RegExpPrototypeSymbolReplace.__intrinsic__call(/([^\n:]*):([^\n]*)(?:\n|$)/g, info, (all, key, val) => {
      if (val.charCodeAt(0) === 0x22) {
        // The translatePeerCertificate function is only
        // used on internally created legacy certificate
        // objects, and any value that contains a quote
        // will always be a valid JSON string literal,
        // so this should never throw.
        val = JSONParse(val);
      }
      if (key in c.infoAccess) ArrayPrototypePush.__intrinsic__call(c.infoAccess[key], val);
      else c.infoAccess[key] = [val];
    });
  }
  return c;
}

const buntls = Symbol.for("::buntls::");

var SocketClass;
const TLSSocket = (function (InternalTLSSocket) {
  SocketClass = InternalTLSSocket;
  Object.defineProperty(SocketClass.prototype, Symbol.toStringTag, {
    value: "TLSSocket",
    enumerable: false,
  });
  function Socket(options) {
    return new InternalTLSSocket(options);
  }
  Socket.prototype = InternalTLSSocket.prototype;
  return Object.defineProperty(Socket, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalTLSSocket;
    },
  });
})(
  class TLSSocket extends InternalTCPSocket {
    #secureContext;
    ALPNProtocols;
    #socket;
    #checkServerIdentity;
    #session;

    constructor(socket, options) {
      super(socket instanceof InternalTCPSocket ? options : options || socket);
      options = options || socket || {};
      if (typeof options === "object") {
        const { ALPNProtocols } = options;
        if (ALPNProtocols) {
          convertALPNProtocols(ALPNProtocols, this);
        }
        if (socket instanceof InternalTCPSocket) {
          this.#socket = socket;
        }
      }

      this.#secureContext = options.secureContext || createSecureContext(options);
      this.authorized = false;
      this.secureConnecting = true;
      this._secureEstablished = false;
      this._securePending = true;
      this.#checkServerIdentity = options.checkServerIdentity || checkServerIdentity;
      this.#session = options.session || null;
    }

    _secureEstablished = false;
    _securePending = true;
    _newSessionPending;
    _controlReleased;
    secureConnecting = false;
    _SNICallback;
    servername;
    authorized = false;
    authorizationError;
    #renegotiationDisabled = false;

    encrypted = true;

    _start() {
      // some frameworks uses this _start internal implementation is suposed to start TLS handshake/connect
      this.connect();
    }

    getSession() {
      return this[bunSocketInternal]?.getSession();
    }

    getEphemeralKeyInfo() {
      return this[bunSocketInternal]?.getEphemeralKeyInfo();
    }

    getCipher() {
      return this[bunSocketInternal]?.getCipher();
    }

    getSharedSigalgs() {
      return this[bunSocketInternal]?.getSharedSigalgs();
    }

    getProtocol() {
      return this[bunSocketInternal]?.getTLSVersion();
    }

    getFinished() {
      return this[bunSocketInternal]?.getTLSFinishedMessage() || undefined;
    }

    getPeerFinished() {
      return this[bunSocketInternal]?.getTLSPeerFinishedMessage() || undefined;
    }
    isSessionReused() {
      return !!this.#session;
    }

    renegotiate() {
      if (this.#renegotiationDisabled) {
        const error = new Error("ERR_TLS_RENEGOTIATION_DISABLED: TLS session renegotiation disabled for this socket");
        error.name = "ERR_TLS_RENEGOTIATION_DISABLED";
        throw error;
      }

      throw Error("Not implented in Bun yet");
    }
    disableRenegotiation() {
      this.#renegotiationDisabled = true;
    }
    getTLSTicket() {
      return this[bunSocketInternal]?.getTLSTicket();
    }
    exportKeyingMaterial(length, label, context) {
      if (context) {
        return this[bunSocketInternal]?.exportKeyingMaterial(length, label, context);
      }
      return this[bunSocketInternal]?.exportKeyingMaterial(length, label);
    }

    setMaxSendFragment(size) {
      return this[bunSocketInternal]?.setMaxSendFragment(size) || false;
    }

    // only for debug purposes so we just mock for now
    enableTrace() {}

    setServername(name) {
      if (this.isServer) {
        let error = new Error("ERR_TLS_SNI_FROM_SERVER: Cannot issue SNI from a TLS server-side socket");
        error.name = "ERR_TLS_SNI_FROM_SERVER";
        throw error;
      }
      // if the socket is detached we can't set the servername but we set this property so when open will auto set to it
      this.servername = name;
      this[bunSocketInternal]?.setServername(name);
    }
    setSession(session) {
      this.#session = session;
      if (typeof session === "string") session = Buffer.from(session, "latin1");
      return this[bunSocketInternal]?.setSession(session);
    }
    getPeerCertificate(abbreviated) {
      const cert =
        arguments.length < 1
          ? this[bunSocketInternal]?.getPeerCertificate()
          : this[bunSocketInternal]?.getPeerCertificate(abbreviated);
      if (cert) {
        return translatePeerCertificate(cert);
      }
    }
    getCertificate() {
      // need to implement certificate on socket.zig
      const cert = this[bunSocketInternal]?.getCertificate();
      if (cert) {
        // It's not a peer cert, but the formatting is identical.
        return translatePeerCertificate(cert);
      }
    }
    getPeerX509Certificate() {
      throw Error("Not implented in Bun yet");
    }
    getX509Certificate() {
      throw Error("Not implented in Bun yet");
    }

    get alpnProtocol() {
      return this[bunSocketInternal]?.alpnProtocol;
    }

    [buntls](port, host) {
      return {
        socket: this.#socket,
        ALPNProtocols: this.ALPNProtocols,
        serverName: this.servername || host || "localhost",
        checkServerIdentity: this.#checkServerIdentity,
        session: this.#session,
        ...this.#secureContext,
      };
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
  ALPNProtocols;

  constructor(options, secureConnectionListener) {
    super(options, secureConnectionListener);
    this.setSecureContext(options);
  }
  setSecureContext(options) {
    if (options instanceof InternalSecureContext) {
      options = options.context;
    }
    if (options) {
      const { ALPNProtocols } = options;

      if (ALPNProtocols) {
        convertALPNProtocols(ALPNProtocols, this);
      }

      let key = options.key;
      if (key) {
        if (!isValidTLSArray(key)) {
          __intrinsic__throwTypeError(
            "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.key = key;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert)) {
          __intrinsic__throwTypeError(
            "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.cert = cert;
      }

      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca)) {
          __intrinsic__throwTypeError(
            "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.ca = ca;
      }

      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string") {
        __intrinsic__throwTypeError("passphrase argument must be an string");
      }
      this.passphrase = passphrase;

      let servername = options.servername;
      if (servername && typeof servername !== "string") {
        __intrinsic__throwTypeError("servername argument must be an string");
      }
      this.servername = servername;

      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number") {
        __intrinsic__throwTypeError("secureOptions argument must be an number");
      }
      this.secureOptions = secureOptions;

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
        ALPNProtocols: this.ALPNProtocols,
      },
      SocketClass,
    ];
  }
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}
const CLIENT_RENEG_LIMIT = 3,
  CLIENT_RENEG_WINDOW = 600,
  DEFAULT_ECDH_CURVE = "auto",
  // https://github.com/Jarred-Sumner/uSockets/blob/fafc241e8664243fc0c51d69684d5d02b9805134/src/crypto/openssl.c#L519-L523
  DEFAULT_CIPHERS =
    "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256",
  DEFAULT_MIN_VERSION = "TLSv1.2",
  DEFAULT_MAX_VERSION = "TLSv1.3",
  createConnection = (port, host, connectListener) => {
    if (typeof port === "object") {
      port.checkServerIdentity || checkServerIdentity;
      const { ALPNProtocols } = port;
      if (ALPNProtocols) {
        convertALPNProtocols(ALPNProtocols, port);
      }
      // port is option pass Socket options and let connect handle connection options
      return new TLSSocket(port).connect(port, host, connectListener);
    }
    // port is path or host, let connect handle this
    return new TLSSocket().connect(port, host, connectListener);
  },
  connect = createConnection;

function getCiphers() {
  return DEFAULT_CIPHERS.split(":");
}

// Convert protocols array into valid OpenSSL protocols list
// ("\x06spdy/2\x08http/1.1\x08http/1.0")
function convertProtocols(protocols) {
  const lens = new Array(protocols.length);
  const buff = Buffer.allocUnsafe(
    ArrayPrototypeReduce.__intrinsic__call(
      protocols,
      (p, c, i) => {
        const len = Buffer.byteLength(c);
        if (len > 255) {
          __intrinsic__throwRangeError(
            "The byte length of the protocol at index " + `${i} exceeds the maximum length.`,
            "<= 255",
            len,
            true,
          );
        }
        lens[i] = len;
        return p + 1 + len;
      },
      0,
    ),
  );

  let offset = 0;
  for (let i = 0, c = protocols.length; i < c; i++) {
    buff[offset++] = lens[i];
    buff.write(protocols[i], offset);
    offset += lens[i];
  }

  return buff;
}

function convertALPNProtocols(protocols, out) {
  // If protocols is Array - translate it into buffer
  if (Array.isArray(protocols)) {
    out.ALPNProtocols = convertProtocols(protocols);
  } else if (isTypedArray(protocols)) {
    // Copy new buffer not to be modified by user.
    out.ALPNProtocols = Buffer.from(protocols);
  } else if (isArrayBufferView(protocols)) {
    out.ALPNProtocols = Buffer.from(
      protocols.buffer.slice(protocols.byteOffset, protocols.byteOffset + protocols.byteLength),
    );
  } else if (Buffer.isBuffer(protocols)) {
    out.ALPNProtocols = protocols;
  }
}

$ = {
  CLIENT_RENEG_LIMIT,
  CLIENT_RENEG_WINDOW,
  connect,
  convertALPNProtocols,
  createConnection,
  createSecureContext,
  createServer,
  DEFAULT_CIPHERS,
  DEFAULT_ECDH_CURVE,
  DEFAULT_MAX_VERSION,
  DEFAULT_MIN_VERSION,
  getCiphers,
  parseCertString,
  SecureContext,
  Server,
  TLSSocket,
  checkServerIdentity,
  rootCertificates,
};
$$EXPORT$$($).$$EXPORT_END$$;
