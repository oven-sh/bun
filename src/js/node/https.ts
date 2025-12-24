// Hardcoded module "node:https"
const http = require("node:http");
const tls = require("node:tls");
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

  http.Agent.$apply(this, [options]);
  this.defaultPort = 443;
  this.protocol = "https:";
  this.maxCachedSessions = this.options.maxCachedSessions;
  if (this.maxCachedSessions === undefined) this.maxCachedSessions = 100;
}
$toClass(Agent, "Agent", http.Agent);
Agent.prototype.createConnection = http.createConnection;

// https.Server extends tls.Server for Node.js compatibility
// This allows methods like addContext() to work on https.Server instances
function Server(options, requestListener): void {
  if (!(this instanceof Server)) {
    return new Server(options, requestListener);
  }

  // Call tls.Server constructor to set up TLS functionality (including addContext)
  tls.Server.$call(this, options, requestListener);
}
$toClass(Server, "Server", tls.Server);

// Copy over http.Server prototype methods that are needed
Server.prototype.setTimeout = http.Server.prototype.setTimeout;
Server.prototype.closeAllConnections = http.Server.prototype.closeAllConnections;
Server.prototype.closeIdleConnections = http.Server.prototype.closeIdleConnections;

function createServer(options, requestListener) {
  if (typeof options === "function") {
    requestListener = options;
    options = {};
  }
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
