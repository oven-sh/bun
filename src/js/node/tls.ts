// Hardcoded module "node:tls"
const { isArrayBufferView, isTypedArray } = require("node:util/types");
const net = require("node:net");
const { Duplex } = require("node:stream");
const [addServerName] = $zig("socket.zig", "createNodeTLSBinding");
const { throwNotImplemented } = require("internal/shared");
const { throwOnInvalidTLSArray, DEFAULT_CIPHERS, validateCiphers } = require("internal/tls");

const { Server: NetServer, Socket: NetSocket } = net;

const { rootCertificates, canonicalizeIP } = $cpp("NodeTLS.cpp", "createNodeTLSBinding");

const SymbolReplace = Symbol.replace;
const RegExpPrototypeSymbolReplace = RegExp.prototype[SymbolReplace];
const RegExpPrototypeExec = RegExp.prototype.exec;
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
        throw $ERR_TLS_CERT_ALTNAME_FORMAT();
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
    return $ERR_TLS_CERT_ALTNAME_INVALID(reason, hostname, cert);
  }
}

var InternalSecureContext = class SecureContext {
  context;
  key;
  cert;
  ca;
  passphrase;
  servername;
  secureOptions;

  constructor(options) {
    const context = {};

    if (options) {
      let cert = options.cert;
      if (cert) {
        throwOnInvalidTLSArray("options.cert", cert);
        this.cert = cert;
      }

      let key = options.key;
      if (key) {
        throwOnInvalidTLSArray("options.key", key);
        this.key = key;
      }

      let ca = options.ca;
      if (ca) {
        throwOnInvalidTLSArray("options.ca", ca);
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

      if (!$isUndefinedOrNull(options.privateKeyIdentifier)) {
        if ($isUndefinedOrNull(options.privateKeyEngine)) {
          // prettier-ignore
          throw $ERR_INVALID_ARG_VALUE("options.privateKeyEngine", options.privateKeyEngine);
        } else if (typeof options.privateKeyEngine !== "string") {
          // prettier-ignore
          throw $ERR_INVALID_ARG_TYPE("options.privateKeyEngine", ["string", "null", "undefined"], options.privateKeyEngine);
        }

        if (typeof options.privateKeyIdentifier !== "string") {
          // prettier-ignore
          throw $ERR_INVALID_ARG_TYPE("options.privateKeyIdentifier", ["string", "null", "undefined"], options.privateKeyIdentifier);
        }
      }
    }

    this.context = context;
  }
};

function SecureContext(options): void {
  // TODO: The `never` exists because TypeScript only lets you construct functions that return void
  // but in reality we should just be calling like InternalSecureContext.$call or similar
  return new InternalSecureContext(options) as never;
}

function createSecureContext(options) {
  return new SecureContext(options);
}

// Translate some fields from the handle's C-friendly format into more idiomatic
// javascript object representations before passing them back to the user.  Can
// be used on any cert object, but changing the name would be semver-major.
function translatePeerCertificate(c) {
  return c;
}

const ksecureContext = Symbol("ksecureContext");
const kcheckServerIdentity = Symbol("kcheckServerIdentity");
const ksession = Symbol("ksession");
const krenegotiationDisabled = Symbol("renegotiationDisabled");

const buntls = Symbol.for("::buntls::");

function TLSSocket(socket?, options?) {
  this[ksecureContext] = undefined;
  this.ALPNProtocols = undefined;
  this[kcheckServerIdentity] = undefined;
  this[ksession] = undefined;
  this.alpnProtocol = null;
  this._secureEstablished = false;
  this._rejectUnauthorized = rejectUnauthorizedDefault;
  this._securePending = true;
  this._newSessionPending = undefined;
  this._controlReleased = undefined;
  this.secureConnecting = false;
  this._SNICallback = undefined;
  this.servername = undefined;
  this.authorized = false;
  this.authorizationError;
  this[krenegotiationDisabled] = undefined;
  this.encrypted = true;

  const isNetSocketOrDuplex = socket instanceof Duplex;

  options = isNetSocketOrDuplex ? { ...options, allowHalfOpen: false } : options || socket || {};

  NetSocket.$call(this, options);

  this.ciphers = options.ciphers;
  if (this.ciphers) {
    validateCiphers(options.ciphers);
  }

  if (typeof options === "object") {
    const { ALPNProtocols } = options;
    if (ALPNProtocols) {
      convertALPNProtocols(ALPNProtocols, this);
    }

    if (isNetSocketOrDuplex) {
      this._handle = socket;
      // keep compatibility with http2-wrapper or other places that try to grab JSStreamSocket in node.js, with here is just the TLSSocket
      this._handle._parentWrap = this;
    }
  }
  this[ksecureContext] = options.secureContext || createSecureContext(options);
  this.authorized = false;
  this.secureConnecting = true;
  this._secureEstablished = false;
  this._securePending = true;
  this[kcheckServerIdentity] = options.checkServerIdentity || checkServerIdentity;
  this[ksession] = options.session || null;
}
$toClass(TLSSocket, "TLSSocket", NetSocket);

TLSSocket.prototype._start = function _start() {
  // some frameworks uses this _start internal implementation is suposed to start TLS handshake/connect
  this.connect();
};

TLSSocket.prototype.getSession = function getSession() {
  return this._handle?.getSession?.();
};

TLSSocket.prototype.getEphemeralKeyInfo = function getEphemeralKeyInfo() {
  return this._handle?.getEphemeralKeyInfo?.();
};

TLSSocket.prototype.getCipher = function getCipher() {
  return this._handle?.getCipher?.();
};

TLSSocket.prototype.getSharedSigalgs = function getSharedSigalgs() {
  return this._handle?.getSharedSigalgs?.();
};

TLSSocket.prototype.getProtocol = function getProtocol() {
  return this._handle?.getTLSVersion?.();
};

TLSSocket.prototype.getFinished = function getFinished() {
  return this._handle?.getTLSFinishedMessage?.() || undefined;
};

TLSSocket.prototype.getPeerFinished = function getPeerFinished() {
  return this._handle?.getTLSPeerFinishedMessage?.() || undefined;
};

TLSSocket.prototype.isSessionReused = function isSessionReused() {
  return !!this[ksession];
};

TLSSocket.prototype.renegotiate = function renegotiate(options, callback) {
  if (this[krenegotiationDisabled]) {
    // if renegotiation is disabled should emit error event in nextTick for nodejs compatibility
    const error = $ERR_TLS_RENEGOTIATION_DISABLED();
    typeof callback === "function" && process.nextTick(callback, error);
    return false;
  }

  const socket = this._handle;
  // if the socket is detached we can't renegotiate, nodejs do a noop too (we should not return false or true here)
  if (!socket) return;

  if (options) {
    let requestCert = !!this._requestCert;
    let rejectUnauthorized = !!this._rejectUnauthorized;

    if (options.requestCert !== undefined) requestCert = !!options.requestCert;
    if (options.rejectUnauthorized !== undefined) rejectUnauthorized = !!options.rejectUnauthorized;

    if (requestCert !== this._requestCert || rejectUnauthorized !== this._rejectUnauthorized) {
      socket.setVerifyMode?.(requestCert, rejectUnauthorized);
      this._requestCert = requestCert;
      this._rejectUnauthorized = rejectUnauthorized;
    }
  }
  try {
    socket.renegotiate?.();
    // if renegotiate is successful should emit secure event when done
    typeof callback === "function" && this.once("secure", () => callback(null));
    return true;
  } catch (err) {
    // if renegotiate fails should emit error event in nextTick for nodejs compatibility
    typeof callback === "function" && process.nextTick(callback, err);
    return false;
  }
};

TLSSocket.prototype.disableRenegotiation = function disableRenegotiation() {
  this[krenegotiationDisabled] = true;
  // disable renegotiation on the socket
  return this._handle?.disableRenegotiation?.();
};

TLSSocket.prototype.getTLSTicket = function getTLSTicket() {
  return this._handle?.getTLSTicket?.();
};

TLSSocket.prototype.exportKeyingMaterial = function exportKeyingMaterial(length, label, context) {
  if (context) {
    return this._handle?.exportKeyingMaterial?.(length, label, context);
  }
  return this._handle?.exportKeyingMaterial?.(length, label);
};

TLSSocket.prototype.setMaxSendFragment = function setMaxSendFragment(size) {
  return this._handle?.setMaxSendFragment?.(size) || false;
};

TLSSocket.prototype.enableTrace = function enableTrace() {
  // only for debug purposes so we just mock for now
};

TLSSocket.prototype.setServername = function setServername(name) {
  if (this.isServer) {
    throw $ERR_TLS_SNI_FROM_SERVER();
  }
  // if the socket is detached we can't set the servername but we set this property so when open will auto set to it
  this.servername = name;
  this._handle?.setServername?.(name);
};

TLSSocket.prototype.setSession = function setSession(session) {
  this[ksession] = session;
  if (typeof session === "string") session = Buffer.from(session, "latin1");
  return this._handle?.setSession?.(session);
};

TLSSocket.prototype.getPeerCertificate = function getPeerCertificate(abbreviated) {
  const cert =
    arguments.length < 1 ? this._handle?.getPeerCertificate?.() : this._handle?.getPeerCertificate?.(abbreviated);
  if (cert) {
    return translatePeerCertificate(cert);
  }
};

TLSSocket.prototype.getCertificate = function getCertificate() {
  // need to implement certificate on socket.zig
  const cert = this._handle?.getCertificate?.();
  if (cert) {
    // It's not a peer cert, but the formatting is identical.
    return translatePeerCertificate(cert);
  }
};

TLSSocket.prototype.getPeerX509Certificate = function getPeerX509Certificate() {
  return this._handle?.getPeerX509Certificate?.();
};

TLSSocket.prototype.getX509Certificate = function getX509Certificate() {
  return this._handle?.getX509Certificate?.();
};

TLSSocket.prototype[buntls] = function (port, host) {
  return {
    socket: this._handle,
    ALPNProtocols: this.ALPNProtocols,
    serverName: this.servername || host || "localhost",
    checkServerIdentity: this[kcheckServerIdentity],
    session: this[ksession],
    rejectUnauthorized: this._rejectUnauthorized,
    requestCert: this._requestCert,
    ciphers: this.ciphers,
    ...this[ksecureContext],
  };
};

let CLIENT_RENEG_LIMIT = 3,
  CLIENT_RENEG_WINDOW = 600;

function Server(options, secureConnectionListener): void {
  if (!(this instanceof Server)) {
    return new Server(options, secureConnectionListener);
  }

  NetServer.$apply(this, [options, secureConnectionListener]);

  this.key = undefined;
  this.cert = undefined;
  this.ca = undefined;
  this.passphrase = undefined;
  this.secureOptions = undefined;
  this._rejectUnauthorized = rejectUnauthorizedDefault;
  this._requestCert = undefined;
  this.servername = undefined;
  this.ALPNProtocols = undefined;

  let contexts: Map<string, typeof InternalSecureContext> | null = null;

  this.addContext = function (hostname, context) {
    if (typeof hostname !== "string") {
      throw new TypeError("hostname must be a string");
    }
    if (!(context instanceof InternalSecureContext)) {
      context = createSecureContext(context);
    }
    if (this._handle) {
      addServerName(this._handle, hostname, context);
    } else {
      if (!contexts) contexts = new Map();
      contexts.set(hostname, context);
    }
  };

  this.setSecureContext = function (options) {
    if (options instanceof InternalSecureContext) {
      options = options.context;
    }
    if (options) {
      const { ALPNProtocols } = options;

      if (ALPNProtocols) {
        convertALPNProtocols(ALPNProtocols, this);
      }

      let cert = options.cert;
      if (cert) {
        throwOnInvalidTLSArray("options.cert", cert);
        this.cert = cert;
      }

      let key = options.key;
      if (key) {
        throwOnInvalidTLSArray("options.key", key);
        this.key = key;
      }

      let ca = options.ca;
      if (ca) {
        throwOnInvalidTLSArray("options.ca", ca);
        this.ca = ca;
      }

      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string") {
        throw $ERR_INVALID_ARG_TYPE("options.passphrase", "string", passphrase);
      }
      this.passphrase = passphrase;

      let servername = options.servername;
      if (servername && typeof servername !== "string") {
        throw $ERR_INVALID_ARG_TYPE("options.servername", "string", servername);
      }
      this.servername = servername;

      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number") {
        throw $ERR_INVALID_ARG_TYPE("options.secureOptions", "number", secureOptions);
      }
      this.secureOptions = secureOptions;

      const requestCert = options.requestCert || false;

      if (requestCert) this._requestCert = requestCert;
      else this._requestCert = undefined;

      const rejectUnauthorized = options.rejectUnauthorized;

      if (typeof rejectUnauthorized !== "undefined") {
        this._rejectUnauthorized = rejectUnauthorized;
      } else this._rejectUnauthorized = rejectUnauthorizedDefault;

      if (typeof options.ciphers !== "undefined") {
        if (typeof options.ciphers !== "string") {
          throw $ERR_INVALID_ARG_TYPE("options.ciphers", "string", options.ciphers);
        }

        validateCiphers(options.ciphers);

        // TODO: Pass the ciphers
      }
    }
  };

  Server.prototype.getTicketKeys = function () {
    throw Error("Not implented in Bun yet");
  };

  Server.prototype.setTicketKeys = function () {
    throw Error("Not implented in Bun yet");
  };

  this[buntls] = function (port, host, isClient) {
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
        contexts: contexts,
      },
      TLSSocket,
    ];
  };

  this.setSecureContext(options);
}
$toClass(Server, "Server", NetServer);

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}
const DEFAULT_ECDH_CURVE = "auto",
  // https://github.com/Jarred-Sumner/uSockets/blob/fafc241e8664243fc0c51d69684d5d02b9805134/src/crypto/openssl.c#L519-L523
  DEFAULT_MIN_VERSION = "TLSv1.2",
  DEFAULT_MAX_VERSION = "TLSv1.3";

function normalizeConnectArgs(listArgs) {
  const args = net._normalizeArgs(listArgs);
  $assert($isObject(args[0]));

  // If args[0] was options, then normalize dealt with it.
  // If args[0] is port, or args[0], args[1] is host, port, we need to
  // find the options and merge them in, normalize's options has only
  // the host/port/path args that it knows about, not the tls options.
  // This means that options.host overrides a host arg.
  if (listArgs[1] !== null && typeof listArgs[1] === "object") {
    ObjectAssign(args[0], listArgs[1]);
  } else if (listArgs[2] !== null && typeof listArgs[2] === "object") {
    ObjectAssign(args[0], listArgs[2]);
  }

  return args;
}

// tls.connect(options[, callback])
// tls.connect(path[, options][, callback])
// tls.connect(port[, host][, options][, callback])
function connect(...args) {
  let normal = normalizeConnectArgs(args);
  const options = normal[0];
  const { ALPNProtocols } = options as { ALPNProtocols?: unknown };

  if (ALPNProtocols) {
    convertALPNProtocols(ALPNProtocols, options);
  }

  return new TLSSocket(options).connect(normal);
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
  get rootCertificates() {
    return rootCertificates;
  },
} as any as typeof import("node:tls");
