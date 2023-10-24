(function (){"use strict";// build3/tmp/node/tls.ts
var parseCertString = function() {
  throwNotImplemented("Not implemented");
};
var isValidTLSArray = function(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || obj instanceof @ArrayBuffer || obj instanceof Blob)
    return true;
  if (@Array.isArray(obj)) {
    for (var i = 0;i < obj.length; i++) {
      if (typeof obj !== "string" && !isTypedArray(obj) && !(obj instanceof @ArrayBuffer) && !(obj instanceof Blob))
        return false;
    }
    return true;
  }
};
var unfqdn = function(host) {
  return RegExpPrototypeSymbolReplace.@call(/[.]$/, host, "");
};
var toLowerCase = function(c) {
  return StringFromCharCode.@call(32 + StringPrototypeCharCodeAt.@call(c, 0));
};
var splitHost = function(host) {
  return StringPrototypeSplit.@call(RegExpPrototypeSymbolReplace.@call(/[A-Z]/g, unfqdn(host), toLowerCase), ".");
};
var check = function(hostParts, pattern, wildcards) {
  if (!pattern)
    return false;
  const patternParts = splitHost(pattern);
  if (hostParts.length !== patternParts.length)
    return false;
  if (ArrayPrototypeIncludes.@call(patternParts, ""))
    return false;
  const isBad = (s) => RegExpPrototypeExec.@call(/[^\u0021-\u007F]/u, s) !== null;
  if (ArrayPrototypeSome.@call(patternParts, isBad))
    return false;
  for (let i = hostParts.length - 1;i > 0; i -= 1) {
    if (hostParts[i] !== patternParts[i])
      return false;
  }
  const hostSubdomain = hostParts[0];
  const patternSubdomain = patternParts[0];
  const patternSubdomainParts = StringPrototypeSplit.@call(patternSubdomain, "*");
  if (patternSubdomainParts.length === 1 || StringPrototypeIncludes.@call(patternSubdomain, "xn--"))
    return hostSubdomain === patternSubdomain;
  if (!wildcards)
    return false;
  if (patternSubdomainParts.length > 2)
    return false;
  if (patternParts.length <= 2)
    return false;
  const { 0: prefix, 1: suffix } = patternSubdomainParts;
  if (prefix.length + suffix.length > hostSubdomain.length)
    return false;
  if (!StringPrototypeStartsWith.@call(hostSubdomain, prefix))
    return false;
  if (!StringPrototypeEndsWith.@call(hostSubdomain, suffix))
    return false;
  return true;
};
var splitEscapedAltNames = function(altNames) {
  const result = [];
  let currentToken = "";
  let offset = 0;
  while (offset !== altNames.length) {
    const nextSep = StringPrototypeIndexOf.@call(altNames, ", ", offset);
    const nextQuote = StringPrototypeIndexOf.@call(altNames, '"', offset);
    if (nextQuote !== -1 && (nextSep === -1 || nextQuote < nextSep)) {
      currentToken += StringPrototypeSubstring.@call(altNames, offset, nextQuote);
      const match = RegExpPrototypeExec.@call(jsonStringPattern, StringPrototypeSubstring.@call(altNames, nextQuote));
      if (!match) {
        let error = new SyntaxError("ERR_TLS_CERT_ALTNAME_FORMAT: Invalid subject alternative name string");
        error.name = ERR_TLS_CERT_ALTNAME_FORMAT;
        throw error;
      }
      currentToken += JSON.parse(match[0]);
      offset = nextQuote + match[0].length;
    } else if (nextSep !== -1) {
      currentToken += StringPrototypeSubstring.@call(altNames, offset, nextSep);
      ArrayPrototypePush.@call(result, currentToken);
      currentToken = "";
      offset = nextSep + 2;
    } else {
      currentToken += StringPrototypeSubstring.@call(altNames, offset);
      offset = altNames.length;
    }
  }
  ArrayPrototypePush.@call(result, currentToken);
  return result;
};
var checkServerIdentity = function(hostname, cert) {
  const subject = cert.subject;
  const altNames = cert.subjectaltname;
  const dnsNames = [];
  const ips = [];
  hostname = "" + hostname;
  if (altNames) {
    const splitAltNames = StringPrototypeIncludes.@call(altNames, '"') ? splitEscapedAltNames(altNames) : StringPrototypeSplit.@call(altNames, ", ");
    ArrayPrototypeForEach.@call(splitAltNames, (name) => {
      if (StringPrototypeStartsWith.@call(name, "DNS:")) {
        ArrayPrototypePush.@call(dnsNames, StringPrototypeSlice.@call(name, 4));
      } else if (StringPrototypeStartsWith.@call(name, "IP Address:")) {
        ArrayPrototypePush.@call(ips, canonicalizeIP(StringPrototypeSlice.@call(name, 11)));
      }
    });
  }
  let valid = false;
  let reason = "Unknown reason";
  hostname = unfqdn(hostname);
  if (net.isIP(hostname)) {
    valid = ArrayPrototypeIncludes.@call(ips, canonicalizeIP(hostname));
    if (!valid)
      reason = `IP: ${hostname} is not in the cert's list: ` + ArrayPrototypeJoin.@call(ips, ", ");
  } else if (dnsNames.length > 0 || subject?.CN) {
    const hostParts = splitHost(hostname);
    const wildcard = (pattern) => check(hostParts, pattern, true);
    if (dnsNames.length > 0) {
      valid = ArrayPrototypeSome.@call(dnsNames, wildcard);
      if (!valid)
        reason = `Host: ${hostname}. is not in the cert's altnames: ${altNames}`;
    } else {
      const cn = subject.CN;
      if (@Array.isArray(cn))
        valid = ArrayPrototypeSome.@call(cn, wildcard);
      else if (cn)
        valid = wildcard(cn);
      if (!valid)
        reason = `Host: ${hostname}. is not cert's CN: ${cn}`;
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
};
var SecureContext = function(options) {
  return new InternalSecureContext(options);
};
var createSecureContext = function(options) {
  return new SecureContext(options);
};
var translatePeerCertificate = function(c) {
  if (!c)
    return null;
  if (c.issuerCertificate != null && c.issuerCertificate !== c) {
    c.issuerCertificate = translatePeerCertificate(c.issuerCertificate);
  }
  if (c.infoAccess != null) {
    const info = c.infoAccess;
    c.infoAccess = { __proto__: null };
    RegExpPrototypeSymbolReplace.@call(/([^\n:]*):([^\n]*)(?:\n|$)/g, info, (all, key, val) => {
      if (val.charCodeAt(0) === 34) {
        val = JSONParse(val);
      }
      if (key in c.infoAccess)
        ArrayPrototypePush.@call(c.infoAccess[key], val);
      else
        c.infoAccess[key] = [val];
    });
  }
  return c;
};
var createServer = function(options, connectionListener) {
  return new Server(options, connectionListener);
};
var getCiphers = function() {
  return DEFAULT_CIPHERS.split(":");
};
var convertProtocols = function(protocols) {
  const lens = new @Array(protocols.length);
  const buff = @Buffer.allocUnsafe(ArrayPrototypeReduce.@call(protocols, (p, c, i) => {
    const len = @Buffer.byteLength(c);
    if (len > 255) {
      @throwRangeError("The byte length of the protocol at index " + `${i} exceeds the maximum length.`, "<= 255", len, true);
    }
    lens[i] = len;
    return p + 1 + len;
  }, 0));
  let offset = 0;
  for (let i = 0, c = protocols.length;i < c; i++) {
    buff[offset++] = lens[i];
    buff.write(protocols[i], offset);
    offset += lens[i];
  }
  return buff;
};
var convertALPNProtocols = function(protocols, out) {
  if (@Array.isArray(protocols)) {
    out.ALPNProtocols = convertProtocols(protocols);
  } else if (isTypedArray(protocols)) {
    out.ALPNProtocols = @Buffer.from(protocols);
  } else if (isArrayBufferView(protocols)) {
    out.ALPNProtocols = @Buffer.from(protocols.buffer.slice(protocols.byteOffset, protocols.byteOffset + protocols.byteLength));
  } else if (@Buffer.isBuffer(protocols)) {
    out.ALPNProtocols = protocols;
  }
};
var $;
var { isArrayBufferView, isTypedArray } = @requireNativeModule("util/types");
var net = @getInternalField(@internalModuleRegistry, 27) || @createInternalModuleById(27);
var { Server: NetServer, [Symbol.for("::bunternal::")]: InternalTCPSocket } = net;
var bunSocketInternal = Symbol.for("::bunnetsocketinternal::");
var { rootCertificates, canonicalizeIP } = @lazy("internal/tls");
var SymbolReplace = Symbol.replace;
var RegExpPrototypeSymbolReplace = @RegExp.prototype[SymbolReplace];
var RegExpPrototypeExec = @RegExp.prototype.exec;
var StringPrototypeStartsWith = @String.prototype.startsWith;
var StringPrototypeSlice = @String.prototype.slice;
var StringPrototypeIncludes = @String.prototype.includes;
var StringPrototypeSplit = @String.prototype.split;
var StringPrototypeIndexOf = @String.prototype.indexOf;
var StringPrototypeSubstring = @String.prototype.substring;
var StringPrototypeEndsWith = @String.prototype.endsWith;
var StringFromCharCode = @String.fromCharCode;
var StringPrototypeCharCodeAt = @String.prototype.charCodeAt;
var ArrayPrototypeIncludes = @Array.prototype.includes;
var ArrayPrototypeJoin = @Array.prototype.join;
var ArrayPrototypeForEach = @Array.prototype.forEach;
var ArrayPrototypePush = @Array.prototype.push;
var ArrayPrototypeSome = @Array.prototype.some;
var ArrayPrototypeReduce = @Array.prototype.reduce;
var jsonStringPattern = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/;
var InternalSecureContext = class SecureContext2 {
  context;
  constructor(options) {
    const context = {};
    if (options) {
      let key = options.key;
      if (key) {
        if (!isValidTLSArray(key)) {
          @throwTypeError("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        }
        this.key = key;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert)) {
          @throwTypeError("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        }
        this.cert = cert;
      }
      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca)) {
          @throwTypeError("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        }
        this.ca = ca;
      }
      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string") {
        @throwTypeError("passphrase argument must be an string");
      }
      this.passphrase = passphrase;
      let servername = options.servername;
      if (servername && typeof servername !== "string") {
        @throwTypeError("servername argument must be an string");
      }
      this.servername = servername;
      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number") {
        @throwTypeError("secureOptions argument must be an number");
      }
      this.secureOptions = secureOptions;
    }
    this.context = context;
  }
};
var buntls = Symbol.for("::buntls::");
var SocketClass;
var TLSSocket = function(InternalTLSSocket) {
  SocketClass = InternalTLSSocket;
  Object.defineProperty(SocketClass.prototype, Symbol.toStringTag, {
    value: "TLSSocket",
    enumerable: false
  });
  function Socket(options) {
    return new InternalTLSSocket(options);
  }
  Socket.prototype = InternalTLSSocket.prototype;
  return Object.defineProperty(Socket, Symbol.hasInstance, {
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
    return this[bunSocketInternal]?.getTLSFinishedMessage() || @undefined;
  }
  getPeerFinished() {
    return this[bunSocketInternal]?.getTLSPeerFinishedMessage() || @undefined;
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
  enableTrace() {
  }
  setServername(name) {
    if (this.isServer) {
      let error = new Error("ERR_TLS_SNI_FROM_SERVER: Cannot issue SNI from a TLS server-side socket");
      error.name = "ERR_TLS_SNI_FROM_SERVER";
      throw error;
    }
    this.servername = name;
    this[bunSocketInternal]?.setServername(name);
  }
  setSession(session) {
    this.#session = session;
    if (typeof session === "string")
      session = @Buffer.from(session, "latin1");
    return this[bunSocketInternal]?.setSession(session);
  }
  getPeerCertificate(abbreviated) {
    const cert = arguments.length < 1 ? this[bunSocketInternal]?.getPeerCertificate() : this[bunSocketInternal]?.getPeerCertificate(abbreviated);
    if (cert) {
      return translatePeerCertificate(cert);
    }
  }
  getCertificate() {
    const cert = this[bunSocketInternal]?.getCertificate();
    if (cert) {
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
          @throwTypeError("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        }
        this.key = key;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert)) {
          @throwTypeError("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        }
        this.cert = cert;
      }
      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca)) {
          @throwTypeError("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        }
        this.ca = ca;
      }
      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string") {
        @throwTypeError("passphrase argument must be an string");
      }
      this.passphrase = passphrase;
      let servername = options.servername;
      if (servername && typeof servername !== "string") {
        @throwTypeError("servername argument must be an string");
      }
      this.servername = servername;
      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number") {
        @throwTypeError("secureOptions argument must be an number");
      }
      this.secureOptions = secureOptions;
      const requestCert = options.requestCert || false;
      if (requestCert)
        this._requestCert = requestCert;
      else
        this._requestCert = @undefined;
      const rejectUnauthorized = options.rejectUnauthorized || false;
      if (rejectUnauthorized) {
        this._rejectUnauthorized = rejectUnauthorized;
      } else
        this._rejectUnauthorized = @undefined;
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
        rejectUnauthorized: isClient ? false : this._rejectUnauthorized,
        requestCert: isClient ? false : this._requestCert,
        ALPNProtocols: this.ALPNProtocols
      },
      SocketClass
    ];
  }
}
var CLIENT_RENEG_LIMIT = 3;
var CLIENT_RENEG_WINDOW = 600;
var DEFAULT_ECDH_CURVE = "auto";
var DEFAULT_CIPHERS = "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256";
var DEFAULT_MIN_VERSION = "TLSv1.2";
var DEFAULT_MAX_VERSION = "TLSv1.3";
var createConnection = (port, host, connectListener) => {
  if (typeof port === "object") {
    port.checkServerIdentity;
    const { ALPNProtocols } = port;
    if (ALPNProtocols) {
      convertALPNProtocols(ALPNProtocols, port);
    }
    return new TLSSocket(port).connect(port, host, connectListener);
  }
  return new TLSSocket().connect(port, host, connectListener);
};
var connect = createConnection;
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
  rootCertificates
};
return $})
