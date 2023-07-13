import {isArrayBufferView, isTypedArray} from "node:util/types";
import net, {Server as NetServer} from "node:net";
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
}, unfqdn = function(host2) {
  return RegExpPrototypeSymbolReplace.call(/[.]$/, host2, "");
}, toLowerCase = function(c) {
  return StringFromCharCode.call(32 + StringPrototypeCharCodeAt.call(c, 0));
}, splitHost = function(host2) {
  return StringPrototypeSplit.call(RegExpPrototypeSymbolReplace.call(/[A-Z]/g, unfqdn(host2), toLowerCase), ".");
}, check = function(hostParts, pattern, wildcards) {
  if (!pattern)
    return !1;
  const patternParts = splitHost(pattern);
  if (hostParts.length !== patternParts.length)
    return !1;
  if (ArrayPrototypeIncludes.call(patternParts, ""))
    return !1;
  const isBad = (s) => RegExpPrototypeExec.call(/[^\u0021-\u007F]/u, s) !== null;
  if (ArrayPrototypeSome.call(patternParts, isBad))
    return !1;
  for (let i = hostParts.length - 1;i > 0; i -= 1)
    if (hostParts[i] !== patternParts[i])
      return !1;
  const hostSubdomain = hostParts[0], patternSubdomain = patternParts[0], patternSubdomainParts = StringPrototypeSplit.call(patternSubdomain, "*");
  if (patternSubdomainParts.length === 1 || StringPrototypeIncludes.call(patternSubdomain, "xn--"))
    return hostSubdomain === patternSubdomain;
  if (!wildcards)
    return !1;
  if (patternSubdomainParts.length > 2)
    return !1;
  if (patternParts.length <= 2)
    return !1;
  const { 0: prefix, 1: suffix } = patternSubdomainParts;
  if (prefix.length + suffix.length > hostSubdomain.length)
    return !1;
  if (!StringPrototypeStartsWith.call(hostSubdomain, prefix))
    return !1;
  if (!StringPrototypeEndsWith.call(hostSubdomain, suffix))
    return !1;
  return !0;
}, splitEscapedAltNames = function(altNames) {
  const result = [];
  let currentToken = "", offset = 0;
  while (offset !== altNames.length) {
    const nextSep = StringPrototypeIndexOf.call(altNames, ", ", offset), nextQuote = StringPrototypeIndexOf.call(altNames, '"', offset);
    if (nextQuote !== -1 && (nextSep === -1 || nextQuote < nextSep)) {
      currentToken += StringPrototypeSubstring.call(altNames, offset, nextQuote);
      const match = RegExpPrototypeExec.call(jsonStringPattern, StringPrototypeSubstring.call(altNames, nextQuote));
      if (!match) {
        let error = new SyntaxError("ERR_TLS_CERT_ALTNAME_FORMAT: Invalid subject alternative name string");
        throw error.name = ERR_TLS_CERT_ALTNAME_FORMAT, error;
      }
      currentToken += JSON.parse(match[0]), offset = nextQuote + match[0].length;
    } else if (nextSep !== -1)
      currentToken += StringPrototypeSubstring.call(altNames, offset, nextSep), ArrayPrototypePush.call(result, currentToken), currentToken = "", offset = nextSep + 2;
    else
      currentToken += StringPrototypeSubstring.call(altNames, offset), offset = altNames.length;
  }
  return ArrayPrototypePush.call(result, currentToken), result;
}, checkServerIdentity = function(hostname, cert) {
  const { subject, subjectaltname: altNames } = cert, dnsNames = [], ips = [];
  if (hostname = "" + hostname, altNames) {
    const splitAltNames = StringPrototypeIncludes.call(altNames, '"') ? splitEscapedAltNames(altNames) : StringPrototypeSplit.call(altNames, ", ");
    ArrayPrototypeForEach.call(splitAltNames, (name) => {
      if (StringPrototypeStartsWith.call(name, "DNS:"))
        ArrayPrototypePush.call(dnsNames, StringPrototypeSlice.call(name, 4));
      else if (StringPrototypeStartsWith.call(name, "IP Address:"))
        ArrayPrototypePush.call(ips, canonicalizeIP(StringPrototypeSlice.call(name, 11)));
    });
  }
  let valid = !1, reason = "Unknown reason";
  if (hostname = unfqdn(hostname), net.isIP(hostname)) {
    if (valid = ArrayPrototypeIncludes.call(ips, canonicalizeIP(hostname)), !valid)
      reason = `IP: ${hostname} is not in the cert's list: ` + ArrayPrototypeJoin.call(ips, ", ");
  } else if (dnsNames.length > 0 || subject?.CN) {
    const hostParts = splitHost(hostname), wildcard = (pattern) => check(hostParts, pattern, !0);
    if (dnsNames.length > 0) {
      if (valid = ArrayPrototypeSome.call(dnsNames, wildcard), !valid)
        reason = `Host: ${hostname}. is not in the cert's altnames: ${altNames}`;
    } else {
      const cn = subject.CN;
      if (Array.isArray(cn))
        valid = ArrayPrototypeSome.call(cn, wildcard);
      else if (cn)
        valid = wildcard(cn);
      if (!valid)
        reason = `Host: ${hostname}. is not cert's CN: ${cn}`;
    }
  } else
    reason = "Cert does not contain a DNS name";
  if (!valid) {
    let error = new Error(`ERR_TLS_CERT_ALTNAME_INVALID: Hostname/IP does not match certificate's altnames: ${reason}`);
    return error.name = "ERR_TLS_CERT_ALTNAME_INVALID", error.reason = reason, error.host = host, error.cert = cert, error;
  }
}, SecureContext = function(options) {
  return new InternalSecureContext(options);
}, createSecureContext = function(options) {
  return new SecureContext(options);
}, translatePeerCertificate = function(c) {
  if (!c)
    return null;
  if (c.issuerCertificate != null && c.issuerCertificate !== c)
    c.issuerCertificate = translatePeerCertificate(c.issuerCertificate);
  if (c.infoAccess != null) {
    const info = c.infoAccess;
    c.infoAccess = { __proto__: null }, RegExpPrototypeSymbolReplace.call(/([^\n:]*):([^\n]*)(?:\n|$)/g, info, (all, key, val) => {
      if (val.charCodeAt(0) === 34)
        val = JSONParse(val);
      if (key in c.infoAccess)
        ArrayPrototypePush.call(c.infoAccess[key], val);
      else
        c.infoAccess[key] = [val];
    });
  }
  return c;
}, createServer = function(options, connectionListener) {
  return new Server(options, connectionListener);
}, getCiphers = function() {
  return DEFAULT_CIPHERS.split(":");
}, getCurves = function() {
  return;
}, convertProtocols = function(protocols) {
  const lens = new Array(protocols.length), buff = Buffer.allocUnsafe(ArrayPrototypeReduce.call(protocols, (p, c, i) => {
    const len = Buffer.byteLength(c);
    if (len > 255)
      throw new RangeError("The byte length of the protocol at index " + `${i} exceeds the maximum length.`, "<= 255", len, !0);
    return lens[i] = len, p + 1 + len;
  }, 0));
  let offset = 0;
  for (let i = 0, c = protocols.length;i < c; i++)
    buff[offset++] = lens[i], buff.write(protocols[i], offset), offset += lens[i];
  return buff;
}, convertALPNProtocols = function(protocols, out) {
  if (Array.isArray(protocols))
    out.ALPNProtocols = convertProtocols(protocols);
  else if (isTypedArray(protocols))
    out.ALPNProtocols = Buffer.from(protocols);
  else if (isArrayBufferView(protocols))
    out.ALPNProtocols = Buffer.from(protocols.buffer.slice(protocols.byteOffset, protocols.byteOffset + protocols.byteLength));
  else if (Buffer.isBuffer(protocols))
    out.ALPNProtocols = protocols;
}, InternalTCPSocket = net[Symbol.for("::bunternal::")], bunSocketInternal = Symbol.for("::bunnetsocketinternal::"), { RegExp, Array, String } = globalThis[Symbol.for("Bun.lazy")]("primordials"), SymbolReplace = Symbol.replace, RegExpPrototypeSymbolReplace = RegExp.prototype[SymbolReplace], RegExpPrototypeExec = RegExp.prototype.exec, StringPrototypeStartsWith = String.prototype.startsWith, StringPrototypeSlice = String.prototype.slice, StringPrototypeIncludes = String.prototype.includes, StringPrototypeSplit = String.prototype.split, StringPrototypeIndexOf = String.prototype.indexOf, StringPrototypeSubstring = String.prototype.substring, StringPrototypeEndsWith = String.prototype.endsWith, StringFromCharCode = String.fromCharCode, StringPrototypeCharCodeAt = String.prototype.charCodeAt, ArrayPrototypeIncludes = Array.prototype.includes, ArrayPrototypeJoin = Array.prototype.join, ArrayPrototypeForEach = Array.prototype.forEach, ArrayPrototypePush = Array.prototype.push, ArrayPrototypeSome = Array.prototype.some, ArrayPrototypeReduce = Array.prototype.reduce, jsonStringPattern = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/, InternalSecureContext = class SecureContext2 {
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
}, buntls = Symbol.for("::buntls::"), SocketClass, TLSSocket = function(InternalTLSSocket) {
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
  ALPNProtocols;
  #socket;
  #checkServerIdentity;
  #session;
  constructor(socket, options) {
    super(socket instanceof InternalTCPSocket ? options : options || socket);
    if (options = options || socket || {}, typeof options === "object") {
      const { ALPNProtocols } = options;
      if (ALPNProtocols)
        convertALPNProtocols(ALPNProtocols, this);
      if (socket instanceof InternalTCPSocket)
        this.#socket = socket;
    }
    this.#secureContext = options.secureContext || createSecureContext(options), this.authorized = !1, this.secureConnecting = !0, this._secureEstablished = !1, this._securePending = !0, this.#checkServerIdentity = options.checkServerIdentity || checkServerIdentity, this.#session = options.session || null;
  }
  _secureEstablished = !1;
  _securePending = !0;
  _newSessionPending;
  _controlReleased;
  secureConnecting = !1;
  _SNICallback;
  servername;
  authorized = !1;
  authorizationError;
  #renegotiationDisabled = !1;
  encrypted = !0;
  _start() {
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
    return this[bunSocketInternal]?.getTLSFinishedMessage() || void 0;
  }
  getPeerFinished() {
    return this[bunSocketInternal]?.getTLSPeerFinishedMessage() || void 0;
  }
  isSessionReused() {
    return !1;
  }
  renegotiate() {
    if (this.#renegotiationDisabled) {
      const error = new Error("ERR_TLS_RENEGOTIATION_DISABLED: TLS session renegotiation disabled for this socket");
      throw error.name = "ERR_TLS_RENEGOTIATION_DISABLED", error;
    }
    throw Error("Not implented in Bun yet");
  }
  disableRenegotiation() {
    this.#renegotiationDisabled = !0;
  }
  getTLSTicket() {
    return this[bunSocketInternal]?.getTLSTicket();
  }
  exportKeyingMaterial(length, label, context) {
    return this[bunSocketInternal]?.exportKeyingMaterial(length, label, context);
  }
  setMaxSendFragment(size) {
    return this[bunSocketInternal]?.setMaxSendFragment(size) || !1;
  }
  enableTrace() {
  }
  setServername(name) {
    if (this.isServer) {
      let error = new Error("ERR_TLS_SNI_FROM_SERVER: Cannot issue SNI from a TLS server-side socket");
      throw error.name = "ERR_TLS_SNI_FROM_SERVER", error;
    }
    this.servername = name, this[bunSocketInternal]?.setServername(name);
  }
  setSession(session) {
    if (typeof session === "string")
      session = Buffer.from(session, "latin1");
    return this[bunSocketInternal]?.setSession(session);
  }
  getPeerCertificate(abbreviated) {
    const cert = arguments.length < 1 ? this[bunSocketInternal]?.getPeerCertificate() : this[bunSocketInternal]?.getPeerCertificate(abbreviated);
    if (cert)
      return translatePeerCertificate(cert);
  }
  getCertificate() {
    const cert = this[bunSocketInternal]?.getCertificate();
    if (cert)
      return translatePeerCertificate(cert);
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
  [buntls](port, host2) {
    return {
      socket: this.#socket,
      ALPNProtocols: this.ALPNProtocols,
      serverName: this.servername || host2 || "localhost",
      checkServerIdentity: this.#checkServerIdentity,
      session: this.#session,
      ...this.#secureContext
    };
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
  ALPNProtocols;
  constructor(options, secureConnectionListener) {
    super(options, secureConnectionListener);
    this.setSecureContext(options);
  }
  setSecureContext(options) {
    if (options instanceof InternalSecureContext)
      options = options.context;
    if (options) {
      const { ALPNProtocols } = options;
      if (ALPNProtocols)
        convertALPNProtocols(ALPNProtocols, this);
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
  [buntls](port, host2, isClient) {
    return [
      {
        serverName: this.servername || host2 || "localhost",
        key: this.key,
        cert: this.cert,
        ca: this.ca,
        passphrase: this.passphrase,
        secureOptions: this.secureOptions,
        rejectUnauthorized: isClient ? !1 : this._rejectUnauthorized,
        requestCert: isClient ? !1 : this._requestCert,
        ALPNProtocols: this.ALPNProtocols
      },
      SocketClass
    ];
  }
}
var CLIENT_RENEG_LIMIT = 3, CLIENT_RENEG_WINDOW = 600, DEFAULT_ECDH_CURVE = "auto", DEFAULT_CIPHERS = "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256", DEFAULT_MIN_VERSION = "TLSv1.2", DEFAULT_MAX_VERSION = "TLSv1.3", createConnection = (port, host2, connectListener) => {
  if (typeof port === "object") {
    port.checkServerIdentity;
    const { ALPNProtocols } = port;
    if (ALPNProtocols)
      convertALPNProtocols(ALPNProtocols, port);
    return new TLSSocket(port).connect(port, host2, connectListener);
  }
  return new TLSSocket().connect(port, host2, connectListener);
}, connect = createConnection, exports = {
  [Symbol.for("CommonJS")]: 0,
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
  getCurves,
  parseCertString,
  SecureContext,
  Server,
  TLSSocket
};
export {
  parseCertString,
  getCurves,
  getCiphers,
  exports as default,
  createServer,
  createSecureContext,
  createConnection,
  convertALPNProtocols,
  connect,
  checkServerIdentity,
  TLSSocket,
  Server,
  SecureContext,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
  DEFAULT_ECDH_CURVE,
  DEFAULT_CIPHERS,
  CLIENT_RENEG_WINDOW,
  CLIENT_RENEG_LIMIT
};
