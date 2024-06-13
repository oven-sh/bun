// Hardcoded module "node:https"
const http = require("node:http");

const ObjectSetPrototypeOf = Object.setPrototypeOf;

function request(input, options, cb) {
  if (input && typeof input === "object" && !(input instanceof URL)) {
    input.protocol ??= "https:";
  } else if (typeof options === "object") {
    options.protocol ??= "https:";
  }

  return http.request(input, options, cb);
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
Agent.prototype = {};
ObjectSetPrototypeOf(Agent.prototype, http.Agent.prototype);
Agent.prototype.createConnection = http.createConnection;

export default {
  ...http,
  get,
  request,
  Agent,
};
