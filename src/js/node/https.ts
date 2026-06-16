// Hardcoded module "node:https"
const http = require("node:http");
const { urlToHttpOptions } = require("internal/url");

const ArrayPrototypeShift = Array.prototype.shift;
const ObjectAssign = Object.assign;
const ArrayPrototypeUnshift = Array.prototype.unshift;

function request(...args) {
  let options = {};

  if (typeof args[0] === "string") {
    const urlStr = ArrayPrototypeShift.$call(args);
    options = urlToHttpOptions(new URL(urlStr));
  } else if (args[0] instanceof URL) {
    options = urlToHttpOptions(ArrayPrototypeShift.$call(args));
  }

  if (args[0] && typeof args[0] !== "function") {
    ObjectAssign.$call(null, options, ArrayPrototypeShift.$call(args));
  }

  options._defaultAgent = https.globalAgent;
  ArrayPrototypeUnshift.$call(args, options);

  return new http.ClientRequest(...args);
}

function get(input, options, cb) {
  const req = request(input, options, cb);
  req.end();
  return req;
}

function Agent(options) {
  if (!(this instanceof Agent)) return new Agent(options);

  options = { __proto__: null, ...options };
  options.defaultPort ??= 443;
  options.protocol ??= "https:";
  http.Agent.$apply(this, [options]);

  this.maxCachedSessions = this.options.maxCachedSessions;
  if (this.maxCachedSessions === undefined) this.maxCachedSessions = 100;
}
$toClass(Agent, "Agent", http.Agent);
Agent.prototype.createConnection = function createConnection(...args) {
  // XXX: This signature (port, host, options) is different from all the other
  // createConnection() methods.
  let options;
  if (args[0] !== null && typeof args[0] === "object") {
    options = args[0];
  } else if (args[1] !== null && typeof args[1] === "object") {
    options = { ...args[1] };
  } else if (args[2] === null || typeof args[2] !== "object") {
    options = {};
  } else {
    options = { ...args[2] };
  }

  if (typeof args[0] === "number") {
    options.port = args[0];
  }

  if (typeof args[1] === "string") {
    options.host = args[1];
  }

  return require("node:tls").connect(options);
};

// Bun's http.Server already handles TLS internally via Bun.serve when given
// `cert`/`key`/`ca` options, so https.Server can compose http.Server while
// exposing the tls.Server API surface that node:https consumers expect
// (`addContext`, `setSecureContext`, `getTicketKeys`, `setTicketKeys`).
function Server(options, callback) {
  if (!(this instanceof Server)) return new Server(options, callback);

  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (options == null) {
    options = {};
  }

  http.Server.$call(this, options, callback);

  // SNI contexts are recorded here; wiring them into the live Bun.serve TLS
  // handshake (so they actually select per-hostname certs) is a follow-up —
  // http.Server terminates TLS via Bun.serve, not the raw socket handle that
  // tls.Server.addContext drives.
  let contexts: Map<string, any> | null = null;

  this.addContext = function (hostname, context) {
    if (typeof hostname !== "string") {
      throw new TypeError("hostname must be a string");
    }
    if (!contexts) contexts = new Map();
    contexts.$set(hostname, context);
  };

  this.setSecureContext = function (options) {
    // Validate option shapes consistently with tls.Server.setSecureContext.
    if (options == null) return;
    if (options.passphrase !== undefined && typeof options.passphrase !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.passphrase", "string", options.passphrase);
    }
    if (options.servername !== undefined && typeof options.servername !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.servername", "string", options.servername);
    }
    if (options.secureOptions !== undefined && typeof options.secureOptions !== "number") {
      throw $ERR_INVALID_ARG_TYPE("options.secureOptions", "number", options.secureOptions);
    }
    if (options.ciphers !== undefined && typeof options.ciphers !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.ciphers", "string", options.ciphers);
    }
  };
}
$toClass(Server, "Server", http.Server);

// Mirror tls.Server's prototype stubs — full ticket-key support is not yet
// implemented in Bun (matches src/js/node/tls.ts).
Server.prototype.getTicketKeys = function () {
  throw new Error("Not implemented in Bun yet");
};
Server.prototype.setTicketKeys = function () {
  throw new Error("Not implemented in Bun yet");
};

function createServer(options, requestListener) {
  return new Server(options, requestListener);
}

var https = {
  Agent,
  globalAgent: new Agent({ keepAlive: true, scheduling: "lifo", timeout: 5000 }),
  Server,
  createServer,
  get,
  request,
};
export default https;
