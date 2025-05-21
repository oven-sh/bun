const EventEmitter: typeof import("node:events").EventEmitter = require("node:events");

const { kEmptyObject } = require("internal/http");

const { FakeSocket } = require("internal/http/FakeSocket");

const ObjectDefineProperty = Object.defineProperty;

const kfakeSocket = Symbol("kfakeSocket");

const NODE_HTTP_WARNING =
  "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.";

// Define Agent interface
interface Agent extends InstanceType<typeof EventEmitter> {
  defaultPort: number;
  protocol: string;
  options: any;
  requests: Record<string, any>;
  sockets: Record<string, any>;
  freeSockets: Record<string, any>;
  keepAliveMsecs: number;
  keepAlive: boolean;
  maxSockets: number;
  maxFreeSockets: number;
  scheduling: string;
  maxTotalSockets: any;
  totalSocketCount: number;
  [kfakeSocket]?: any;

  createConnection(): any;
  getName(options?: any): string;
  addRequest(): void;
  createSocket(req: any, options: any, cb: (err: any, socket: any) => void): void;
  removeSocket(): void;
  keepSocketAlive(): boolean;
  reuseSocket(): void;
  destroy(): void;
}

// Define the constructor interface
interface AgentConstructor {
  new (options?: any): Agent;
  (options?: any): Agent;
  defaultMaxSockets: number;
  globalAgent: Agent;
  prototype: Agent;
}

function Agent(options = kEmptyObject) {
  if (!(this instanceof Agent)) return new Agent(options);

  EventEmitter.$apply(this, []);

  this.defaultPort = 80;
  this.protocol = "http:";

  this.options = options = { ...options, path: null };
  if (options.noDelay === undefined) options.noDelay = true;

  // Don't confuse net and make it think that we're connecting to a pipe
  this.requests = Object.create(null);
  this.sockets = Object.create(null);
  this.freeSockets = Object.create(null);

  this.keepAliveMsecs = options.keepAliveMsecs || 1000;
  this.keepAlive = options.keepAlive || false;
  this.maxSockets = options.maxSockets || Agent.defaultMaxSockets;
  this.maxFreeSockets = options.maxFreeSockets || 256;
  this.scheduling = options.scheduling || "lifo";
  this.maxTotalSockets = options.maxTotalSockets;
  this.totalSocketCount = 0;
  this.defaultPort = options.defaultPort || 80;
  this.protocol = options.protocol || "http:";
}
$toClass(Agent, "Agent", EventEmitter);

// Type assertion to help TypeScript understand Agent has static properties
const AgentClass = Agent as unknown as AgentConstructor;

ObjectDefineProperty(AgentClass, "globalAgent", {
  get: function () {
    return globalAgent;
  },
});

ObjectDefineProperty(AgentClass, "defaultMaxSockets", {
  get: function () {
    return Infinity;
  },
});

Agent.prototype.createConnection = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createConnection is a no-op, returns fake socket");
  return (this[kfakeSocket] ??= new FakeSocket());
};

Agent.prototype.getName = function (options = kEmptyObject) {
  let name = options.host || "localhost";
  name += ":";
  if (options.port) {
    name += options.port;
  }
  name += ":";
  if (options.localAddress) {
    name += options.localAddress;
  }
  // Pacify parallel/test-http-agent-getname by only appending
  // the ':' when options.family is set.
  if (options.family === 4 || options.family === 6) {
    name += `:${options.family}`;
  }
  if (options.socketPath) {
    name += `:${options.socketPath}`;
  }
  return name;
};

Agent.prototype.addRequest = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.addRequest is a no-op");
};

Agent.prototype.createSocket = function (req, options, cb) {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createSocket returns fake socket");
  cb(null, (this[kfakeSocket] ??= new FakeSocket()));
};

Agent.prototype.removeSocket = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.removeSocket is a no-op");
};

Agent.prototype.keepSocketAlive = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.keepSocketAlive is a no-op");
  return true;
};

Agent.prototype.reuseSocket = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.reuseSocket is a no-op");
};

Agent.prototype.destroy = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.destroy is a no-op");
};

var globalAgent = new Agent();

const http_agent_exports = {
  Agent: AgentClass,
  globalAgent,
  NODE_HTTP_WARNING,
};

export default http_agent_exports;
