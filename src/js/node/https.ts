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
  if (options.agent === undefined) {
    if (options.key !== undefined) {
      options._defaultAgent.options.key = options.key;
    }
    if (options.cert !== undefined) {
      options._defaultAgent.options.cert = options.cert;
    }
    if (options.ca !== undefined) {
      options._defaultAgent.options.ca = options.ca;
    }
  } else {
    if (options.key !== undefined) {
      options.agent.options.key = options.key;
    }
    if (options.cert !== undefined) {
      options.agent.options.cert = options.cert;
    }
    if (options.ca !== undefined) {
      options.agent.options.ca = options.ca;
    }
  }
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

var https = {
  Agent,
  globalAgent: new Agent({ keepAlive: true, scheduling: "lifo", timeout: 5000 }),
  Server: http.Server,
  createServer: http.createServer,
  get,
  request,
};
export default https;
