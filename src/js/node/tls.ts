// Hardcoded module "node:tls"
const { isArrayBufferView, isTypedArray } = require("node:util/types");
const { addServerName } = require("../internal/net");
const net = require("node:net");
const { Server: NetServer, [Symbol.for("::bunternal::")]: InternalTCPSocket } = net;

const bunSocketInternal = Symbol.for("::bunnetsocketinternal::");
const { rootCertificates, canonicalizeIP } = $cpp("NodeTLS.cpp", "createNodeTLSBinding");

const SymbolReplace = Symbol.replace;
const RegExpPrototypeSymbolReplace = RegExp.prototype[SymbolReplace];
const RegExpPrototypeExec = RegExp.prototype.exec;
const JSONParse = JSON.parse;
const ObjectAssign = Object.assign;

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

const rejectUnauthorizedDefault =
  process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "false";
function isValidTLSArray(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || obj instanceof ArrayBuffer || obj instanceof Blob) return true;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (typeof item !== "string" && !isTypedArray(item) && !(item instanceof ArrayBuffer) && !(item instanceof Blob))
        return false;
    }
    return true;
  }
  return false;
}

function unfqdn(host) {
  return RegExpPrototypeSymbolReplace.$call(/[.]$/, host, "");
}
// String#toLowerCase() is locale-sensitive so we use
// a conservative version that only lowercases A-Z.
function toLowerCase(c) {
  return StringFromCharCode.$call(32 + StringPrototypeCharCodeAt.$call(c, 0));
}

function splitHost(host) {
  return StringPrototypeSplit.$call(RegExpPrototypeSymbolReplace.$call(/[A-Z]/g, unfqdn(host), toLowerCase), ".");
}

function check(hostParts, pattern, wildcards) {
  // Empty strings, null, undefined, etc. never match.
  if (!pattern) return false;

  const patternParts = splitHost(pattern);

  if (hostParts.length !== patternParts.length) return false;

  // Pattern has empty components, e.g. "bad..example.com".
  if (ArrayPrototypeIncludes.$call(patternParts, "")) return false;

  // RFC 6125 allows IDNA U-labels (Unicode) in names but we have no
  // good way to detect their encoding or normalize them so we simply
  // reject them.  Control characters and blanks are rejected as well
  // because nothing good can come from accepting them.
  const isBad = s => RegExpPrototypeExec.$call(/[^\u0021-\u007F]/u, s) !== null;
  if (ArrayPrototypeSome.$call(patternParts, isBad)) return false;

  // Check host parts from right to left first.
  for (let i = hostParts.length - 1; i > 0; i -= 1) {
    if (hostParts[i] !== patternParts[i]) return false;
  }

  const hostSubdomain = hostParts[0];
  const patternSubdomain = patternParts[0];
  const patternSubdomainParts = StringPrototypeSplit.$call(patternSubdomain, "*");

  // Short-circuit when the subdomain does not contain a wildcard.
  // RFC 6125 does not allow wildcard substitution for components
  // containing IDNA A-labels (Punycode) so match those verbatim.
  if (patternSubdomainParts.length === 1 || StringPrototypeIncludes.$call(patternSubdomain, "xn--"))
    return hostSubdomain === patternSubdomain;

  if (!wildcards) return false;

  // More than one wildcard is always wrong.
  if (patternSubdomainParts.length > 2) return false;

  // *.tld wildcards are not allowed.
  if (patternParts.length <= 2) return false;

  const { 0: prefix, 1: suffix } = patternSubdomainParts;

  if (prefix.length + suffix.length > hostSubdomain.length) return false;

  if (!StringPrototypeStartsWith.$call(hostSubdomain, prefix)) return false;

  if (!StringPrototypeEndsWith.$call(hostSubdomain, suffix)) return false;

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
    const nextSep = StringPrototypeIndexOf.$call(altNames, ", ", offset);
    const nextQuote = StringPrototypeIndexOf.$call(altNames, '"', offset);
    if (nextQuote !== -1 && (nextSep === -1 || nextQuote < nextSep)) {
      // There is a quote character and there is no separator before the quote.
      currentToken += StringPrototypeSubstring.$call(altNames, offset, nextQuote);
      const match = RegExpPrototypeExec.$call(jsonStringPattern, StringPrototypeSubstring.$call(altNames, nextQuote));
      if (!match) {
        let error = new SyntaxError("ERR_TLS_CERT_ALTNAME_FORMAT: Invalid subject alternative name string");
        error.code = "ERR_TLS_CERT_ALTNAME_FORMAT";
        throw error;
      }
      currentToken += JSON.parse(match[0]);
      offset = nextQuote + match[0].length;
    } else if (nextSep !== -1) {
      // There is a separator and no quote before it.
      currentToken += StringPrototypeSubstring.$call(altNames, offset, nextSep);
      ArrayPrototypePush.$call(result, currentToken);
      currentToken = "";
      offset = nextSep + 2;
    } else {
      currentToken += StringPrototypeSubstring.$call(altNames, offset);
      offset = altNames.length;
    }
  }
  ArrayPrototypePush.$call(result, currentToken);
  return result;
}

function checkServerIdentity(hostname, cert) {
  const subject = cert.subject;
  const altNames = cert.subjectaltname;
  const dnsNames = [];
  const ips = [];

  hostname = "" + hostname;

  if (altNames) {
    const splitAltNames = StringPrototypeIncludes.$call(altNames, '"')
      ? splitEscapedAltNames(altNames)
      : StringPrototypeSplit.$call(altNames, ", ");
    ArrayPrototypeForEach.$call(splitAltNames, name => {
      if (StringPrototypeStartsWith.$call(name, "DNS:")) {
        ArrayPrototypePush.$call(dnsNames, StringPrototypeSlice.$call(name, 4));
      } else if (StringPrototypeStartsWith.$call(name, "IP Address:")) {
        ArrayPrototypePush.$call(ips, canonicalizeIP(StringPrototypeSlice.$call(name, 11)));
      }
    });
  }

  let valid = false;
  let reason = "Unknown reason";

  hostname = unfqdn(hostname); // Remove trailing dot for error messages.
  if (net.isIP(hostname)) {
    valid = ArrayPrototypeIncludes.$call(ips, canonicalizeIP(hostname));
    if (!valid) reason = `IP: ${hostname} is not in the cert's list: ` + ArrayPrototypeJoin.$call(ips, ", ");
  } else if (dnsNames.length > 0 || subject?.CN) {
    const hostParts = splitHost(hostname);
    const wildcard = pattern => check(hostParts, pattern, true);

    if (dnsNames.length > 0) {
      valid = ArrayPrototypeSome.$call(dnsNames, wildcard);
      if (!valid) reason = `Host: ${hostname}. is not in the cert's altnames: ${altNames}`;
    } else {
      // Match against Common Name only if no supported identifiers exist.
      const cn = subject.CN;

      if (Array.isArray(cn)) valid = ArrayPrototypeSome.$call(cn, wildcard);
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
          throw new TypeError(
            "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.key = key;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert)) {
          throw new TypeError(
            "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.cert = cert;
      }

      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca)) {
          throw new TypeError(
            "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.ca = ca;
      }

      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string") {
        throw new TypeError("passphrase argument must be an string");
      }
      this.passphrase = passphrase;

      let servername = options.servername;
      if (servername && typeof servername !== "string") {
        throw new TypeError("servername argument must be an string");
      }
      this.servername = servername;

      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number") {
        throw new TypeError("secureOptions argument must be an number");
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
    RegExpPrototypeSymbolReplace.$call(/([^\n:]*):([^\n]*)(?:\n|$)/g, info, (all, key, val) => {
      if (val.charCodeAt(0) === 0x22) {
        // The translatePeerCertificate function is only
        // used on internally created legacy certificate
        // objects, and any value that contains a quote
        // will always be a valid JSON string literal,
        // so this should never throw.
        val = JSONParse(val);
      }
      if (key in c.infoAccess) ArrayPrototypePush.$call(c.infoAccess[key], val);
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
    _rejectUnauthorized = rejectUnauthorizedDefault;
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

    renegotiate(options, callback) {
      if (this.#renegotiationDisabled) {
        // if renegotiation is disabled should emit error event in nextTick for nodejs compatibility
        const error = new Error("ERR_TLS_RENEGOTIATION_DISABLED: TLS session renegotiation disabled for this socket");
        error.name = "ERR_TLS_RENEGOTIATION_DISABLED";
        typeof callback === "function" && process.nextTick(callback, error);
        return false;
      }

      const socket = this[bunSocketInternal];
      // if the socket is detached we can't renegotiate, nodejs do a noop too (we should not return false or true here)
      if (!socket) return;

      if (options) {
        let requestCert = !!this._requestCert;
        let rejectUnauthorized = !!this._rejectUnauthorized;

        if (options.requestCert !== undefined) requestCert = !!options.requestCert;
        if (options.rejectUnauthorized !== undefined) rejectUnauthorized = !!options.rejectUnauthorized;

        if (requestCert !== this._requestCert || rejectUnauthorized !== this._rejectUnauthorized) {
          socket.setVerifyMode(requestCert, rejectUnauthorized);
          this._requestCert = requestCert;
          this._rejectUnauthorized = rejectUnauthorized;
        }
      }
      try {
        socket.renegotiate();
        // if renegotiate is successful should emit secure event when done
        typeof callback === "function" && this.once("secure", () => callback(null));
        return true;
      } catch (err) {
        // if renegotiate fails should emit error event in nextTick for nodejs compatibility
        typeof callback === "function" && process.nextTick(callback, err);
        return false;
      }
    }

    disableRenegotiation() {
      this.#renegotiationDisabled = true;
      // disable renegotiation on the socket
      return this[bunSocketInternal]?.disableRenegotiation();
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
        rejectUnauthorized: this._rejectUnauthorized,
        requestCert: this._requestCert,
        ...this.#secureContext,
      };
    }
  },
);
let CLIENT_RENEG_LIMIT = 3,
  CLIENT_RENEG_WINDOW = 600;
class Server extends NetServer {
  key;
  cert;
  ca;
  passphrase;
  secureOptions;
  _rejectUnauthorized = rejectUnauthorizedDefault;
  _requestCert;
  servername;
  ALPNProtocols;
  #contexts: Map<string, typeof InternalSecureContext> | null = null;

  constructor(options, secureConnectionListener) {
    super(options, secureConnectionListener);
    this.setSecureContext(options);
  }
  addContext(hostname: string, context: typeof InternalSecureContext | object) {
    if (typeof hostname !== "string") {
      throw new TypeError("hostname must be a string");
    }
    if (!(context instanceof InternalSecureContext)) {
      context = createSecureContext(context);
    }
    if (this[bunSocketInternal]) {
      addServerName(this[bunSocketInternal], hostname, context);
    } else {
      if (!this.#contexts) this.#contexts = new Map();
      this.#contexts.set(hostname, context as typeof InternalSecureContext);
    }
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
          throw new TypeError(
            "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.key = key;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert)) {
          throw new TypeError(
            "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.cert = cert;
      }

      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca)) {
          throw new TypeError(
            "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.ca = ca;
      }

      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string") {
        throw new TypeError("passphrase argument must be an string");
      }
      this.passphrase = passphrase;

      let servername = options.servername;
      if (servername && typeof servername !== "string") {
        throw new TypeError("servername argument must be an string");
      }
      this.servername = servername;

      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number") {
        throw new TypeError("secureOptions argument must be an number");
      }
      this.secureOptions = secureOptions;

      const requestCert = options.requestCert || false;

      if (requestCert) this._requestCert = requestCert;
      else this._requestCert = undefined;

      const rejectUnauthorized = options.rejectUnauthorized;

      if (typeof rejectUnauthorized !== "undefined") {
        this._rejectUnauthorized = rejectUnauthorized;
      } else this._rejectUnauthorized = rejectUnauthorizedDefault;
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
        rejectUnauthorized: this._rejectUnauthorized,
        requestCert: isClient ? true : this._requestCert,
        ALPNProtocols: this.ALPNProtocols,
        clientRenegotiationLimit: CLIENT_RENEG_LIMIT,
        clientRenegotiationWindow: CLIENT_RENEG_WINDOW,
        contexts: this.#contexts,
      },
      SocketClass,
    ];
  }
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}
const DEFAULT_ECDH_CURVE = "auto",
  // https://github.com/Jarred-Sumner/uSockets/blob/fafc241e8664243fc0c51d69684d5d02b9805134/src/crypto/openssl.c#L519-L523
  DEFAULT_CIPHERS =
    "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256",
  DEFAULT_MIN_VERSION = "TLSv1.2",
  DEFAULT_MAX_VERSION = "TLSv1.3";

function normalizeConnectArgs(listArgs) {
  const args = net._normalizeArgs(listArgs);
  const options = args[0];
  const cb = args[1];

  // If args[0] was options, then normalize dealt with it.
  // If args[0] is port, or args[0], args[1] is host, port, we need to
  // find the options and merge them in, normalize's options has only
  // the host/port/path args that it knows about, not the tls options.
  // This means that options.host overrides a host arg.
  if (listArgs[1] !== null && typeof listArgs[1] === "object") {
    ObjectAssign(options, listArgs[1]);
  } else if (listArgs[2] !== null && typeof listArgs[2] === "object") {
    ObjectAssign(options, listArgs[2]);
  }

  return cb ? [options, cb] : [options];
}

// tls.connect(options[, callback])
// tls.connect(path[, options][, callback])
// tls.connect(port[, host][, options][, callback])
function connect(...args) {
  if (typeof args[0] !== "object") {
    return new TLSSocket().connect(...args);
  }
  let [options, callback] = normalizeConnectArgs(args);
  const { ALPNProtocols } = options;
  if (ALPNProtocols) {
    convertALPNProtocols(ALPNProtocols, options);
  }
  return new TLSSocket(options).connect(options, callback);
}

function getCiphers() {
  return DEFAULT_CIPHERS.split(":");
}

// Convert protocols array into valid OpenSSL protocols list
// ("\x06spdy/2\x08http/1.1\x08http/1.0")
function convertProtocols(protocols) {
  const lens = new Array(protocols.length);
  const buff = Buffer.allocUnsafe(
    ArrayPrototypeReduce.$call(
      protocols,
      (p, c, i) => {
        const len = Buffer.byteLength(c);
        if (len > 255) {
          throw new RangeError(
            `The byte length of the protocol at index ${i} exceeds the maximum length. It must be <= 255. Received ${len}`,
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

export default {
  CLIENT_RENEG_LIMIT,
  CLIENT_RENEG_WINDOW,
  connect,
  convertALPNProtocols,
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
