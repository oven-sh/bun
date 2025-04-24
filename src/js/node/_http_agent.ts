import type { EventEmitter as EEType } from "node:events";
const EventEmitter: typeof EEType = require("node:events");

const { kEmptyObject } = require("internal/http");

// Import the type for casting require
import type Socket from "internal/http/FakeSocket";
// The require call might return an object with the class as a property,
// or the class directly depending on module format and bundler behavior.
// We expect { FakeSocket: class } based on the original code and errors.
// Use 'unknown' first to satisfy TS2352 if the types are truly incompatible structurally.
const FakeSocketModule = require("internal/http/FakeSocket") as { FakeSocket: typeof Socket };
// Ensure FakeSocket is correctly typed as the constructor
const FakeSocket: typeof Socket = FakeSocketModule.FakeSocket;

const ObjectDefineProperty = Object.defineProperty;

const kfakeSocket = Symbol("kfakeSocket");

const NODE_HTTP_WARNING =
  "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.";

// Define Agent interface
// Use `any` for kfakeSocket to avoid TS4023 errors leaking internal types.
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
  [kfakeSocket]?: any; // Use `any` to prevent leaking internal types

  createConnection(options?: any, cb?: (err: Error | null, socket: any) => void): any;
  getName(options?: any): string;
  addRequest(req: any, options: any, port?: number | null, localAddress?: string | null): void;
  createSocket(req: any, options: any, cb: (err: Error | null, socket: any) => void): void;
  removeSocket(socket: any, options: any, port?: number | null, localAddress?: string | null): void;
  keepSocketAlive(socket: any): boolean;
  reuseSocket(socket: any, req: any): void;
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

function Agent(this: Agent | void, options = kEmptyObject) {
  // When called as a function, call as a constructor.
  // Use 'Agent as AgentConstructor' to assert the type for the 'new' call.
  if (!(this instanceof (Agent as AgentConstructor))) return new (Agent as AgentConstructor)(options);

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
  // Access static property via cast
  this.maxSockets = options.maxSockets || (Agent as unknown as AgentConstructor).defaultMaxSockets;
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

// Define static properties after the function definition and $toClass call
// It's generally safer to define statics after the class-like structure is set up.
ObjectDefineProperty(AgentClass, "defaultMaxSockets", {
  get: function () {
    return Infinity;
  },
  configurable: true,
  enumerable: true,
});

// Define globalAgent after AgentClass is fully defined with its statics
var globalAgent = new AgentClass();

ObjectDefineProperty(AgentClass, "globalAgent", {
  get: function () {
    return globalAgent;
  },
  configurable: true,
  enumerable: true,
});

Agent.prototype.createConnection = function (this: Agent) {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createConnection is a no-op, returns fake socket");
  // Use the FakeSocket constructor obtained from the require result.
  return (this[kfakeSocket] ??= new FakeSocket());
};

Agent.prototype.getName = function (options = kEmptyObject) {
  let name = `http:${options.host || "localhost"}:`;
  if (options.port) name += options.port;
  name += ":";
  if (options.localAddress) name += options.localAddress;
  // Pacify parallel/test-http-agent-getname by only appending
  // the ':' when options.family is set.
  if (options.family === 4 || options.family === 6) name += `:${options.family}`;
  if (options.socketPath) name += `:${options.socketPath}`;
  return name;
};

Agent.prototype.addRequest = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.addRequest is a no-op");
};

Agent.prototype.createSocket = function (this: Agent, req, options, cb) {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createSocket returns fake socket");
  // Use the FakeSocket constructor obtained from the require result.
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

const http_agent_exports = {
  Agent: AgentClass,
  globalAgent,
  NODE_HTTP_WARNING,
};

export default http_agent_exports;