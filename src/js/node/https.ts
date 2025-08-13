// Hardcoded module "node:https"
const http = require("node:http");
const tls = require("node:tls");
const { urlToHttpOptions, isURL } = require("internal/url");
const { kEmptyObject } = require("internal/shared");

const JSONStringify = JSON.stringify;
const ArrayPrototypeShift = Array.prototype.shift;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeSplice = Array.prototype.splice;
const ArrayPrototypeUnshift = Array.prototype.unshift;
const ObjectAssign = Object.assign;
const ReflectConstruct = Reflect.construct;

function createConnection(port, host, options) {
  if (port !== null && typeof port === "object") {
    options = port;
  } else if (host !== null && typeof host === "object") {
    options = { ...host };
  } else if (options === null || typeof options !== "object") {
    options = {};
  } else {
    options = { ...options };
  }

  if (typeof port === "number") {
    options.port = port;
  }

  if (typeof host === "string") {
    options.host = host;
  }

  $debug("createConnection", options);

  if (options._agentKey) {
    const session = this._getSession(options._agentKey);
    if (session) {
      $debug("reuse session for %j", options._agentKey);
      options = {
        session,
        ...options,
      };
    }
  }

  const socket = tls.connect(options);

  if (options._agentKey) {
    socket.on("session", session => {
      this._cacheSession(options._agentKey, session);
    });

    socket.once("close", err => {
      if (err) this._evictSession(options._agentKey);
    });
  }

  return socket;
}

function Agent(options): void {
  if (!(this instanceof Agent)) return new Agent(options);

  http.Agent.$call(this, options);
  this.defaultPort = 443;
  this.protocol = "https:";
  this.maxCachedSessions = this.options.maxCachedSessions;
  if (this.maxCachedSessions === undefined) this.maxCachedSessions = 100;

  this._sessionCache = {
    map: {},
    list: [],
  };
}
$toClass(Agent, "Agent", http.Agent);

Agent.prototype.createConnection = createConnection;

Agent.prototype.getName = function (options = kEmptyObject as any) {
  let name = http.Agent.prototype.getName.$call(this, options);
  name += ":";
  if (options.ca) name += options.ca;
  name += ":";
  if (options.cert) name += options.cert;
  name += ":";
  if (options.clientCertEngine) name += options.clientCertEngine;
  name += ":";
  if (options.ciphers) name += options.ciphers;
  name += ":";
  if (options.key) name += options.key;
  name += ":";
  if (options.pfx) name += options.pfx;
  name += ":";
  if (options.rejectUnauthorized !== undefined) name += options.rejectUnauthorized;
  name += ":";
  if (options.servername && options.servername !== options.host) name += options.servername;
  name += ":";
  if (options.minVersion) name += options.minVersion;
  name += ":";
  if (options.maxVersion) name += options.maxVersion;
  name += ":";
  if (options.secureProtocol) name += options.secureProtocol;
  name += ":";
  if (options.crl) name += options.crl;
  name += ":";
  if (options.honorCipherOrder !== undefined) name += options.honorCipherOrder;
  name += ":";
  if (options.ecdhCurve) name += options.ecdhCurve;
  name += ":";
  if (options.dhparam) name += options.dhparam;
  name += ":";
  if (options.secureOptions !== undefined) name += options.secureOptions;
  name += ":";
  if (options.sessionIdContext) name += options.sessionIdContext;
  name += ":";
  if (options.sigalgs) name += JSONStringify(options.sigalgs);
  name += ":";
  if (options.privateKeyIdentifier) name += options.privateKeyIdentifier;
  name += ":";
  if (options.privateKeyEngine) name += options.privateKeyEngine;
  return name;
};

Agent.prototype._getSession = function _getSession(key) {
  return this._sessionCache.map[key];
};

Agent.prototype._cacheSession = function _cacheSession(key, session) {
  if (this.maxCachedSessions === 0) return;

  if (this._sessionCache.map[key]) {
    this._sessionCache.map[key] = session;
    return;
  }

  if (this._sessionCache.list.length >= this.maxCachedSessions) {
    const oldKey = ArrayPrototypeShift.$call(this._sessionCache.list);
    $debug("evicting %j", oldKey);
    delete this._sessionCache.map[oldKey];
  }

  ArrayPrototypePush.$call(this._sessionCache.list, key);
  this._sessionCache.map[key] = session;
};

Agent.prototype._evictSession = function _evictSession(key) {
  const index = ArrayPrototypeIndexOf.$call(this._sessionCache.list, key);
  if (index === -1) return;

  ArrayPrototypeSplice.$call(this._sessionCache.list, index, 1);
  delete this._sessionCache.map[key];
};

const globalAgent = new Agent({ keepAlive: true, scheduling: "lifo", timeout: 5000 });

function request(...args) {
  let options: any = {};

  if (typeof args[0] === "string") {
    const urlStr = ArrayPrototypeShift.$call(args);
    options = urlToHttpOptions(new URL(urlStr));
  } else if (isURL(args[0])) {
    options = urlToHttpOptions(ArrayPrototypeShift.$call(args));
  }

  if (args[0] && typeof args[0] !== "function") {
    ObjectAssign(options, ArrayPrototypeShift.$call(args));
  }

  options._defaultAgent = globalAgent;
  ArrayPrototypeUnshift.$call(args, options);

  return ReflectConstruct(http.ClientRequest, args);
}

function get(input, options, cb) {
  const req = request(input, options, cb);
  req.end();
  return req;
}

export default {
  Agent,
  globalAgent,
  Server: http.Server,
  createServer: http.createServer,
  get,
  request,
};
