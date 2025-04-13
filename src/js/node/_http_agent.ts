import { kFakeSocket, FakeSocket } from "internal/http/share";
import EventEmitter from "node:events";
// const net = require("node:net");
const { validateNumber, validateOneOf } = require("internal/validators");
// const { AsyncLocalStorage } = require("node:async_hooks");

const kEmptyObject = Object.freeze(Object.create(null));
// const kOnKeylog = Symbol('onkeylog');
// const kRequestOptions = Symbol('requestOptions');
// const kRequestAsyncSnapshot = Symbol('requestAsyncResource');

// const HTTP_AGENT_KEEP_ALIVE_TIMEOUT_BUFFER = 1000;
const NODE_HTTP_WARNING =
  "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.";

function Agent(options = kEmptyObject): void {
  if (!(this instanceof Agent)) return new Agent(options);
  EventEmitter.$apply(this, []);

  this.defaultPort = 80;
  this.protocol = 'http:';

  this.options = { __proto__: null, ...options };

  if (this.options.noDelay === undefined)
    this.options.noDelay = true;

  // Don't confuse net and make it think that we're connecting to a pipe
  this.options.path = null;
  this.requests = { __proto__: null };
  this.sockets = { __proto__: null };
  this.freeSockets = { __proto__: null };
  this.keepAliveMsecs = this.options.keepAliveMsecs || 1000;
  this.keepAlive = this.options.keepAlive || false;
  this.maxSockets = this.options.maxSockets || Agent.defaultMaxSockets;
  this.maxFreeSockets = this.options.maxFreeSockets || 256;
  this.scheduling = this.options.scheduling || 'lifo';
  this.maxTotalSockets = this.options.maxTotalSockets;
  this.totalSocketCount = 0;

  validateOneOf(this.scheduling, 'scheduling', ['fifo', 'lifo']);

  if (this.maxTotalSockets !== undefined) {
    validateNumber(this.maxTotalSockets, 'maxTotalSockets', 1);
  } else {
    this.maxTotalSockets = Infinity;
  }

  // this.on('free', (socket, options) => {
  //   const name = this.getName(options);
  //   $debug('agent.on(free)', name);

  //   // TODO(ronag): socket.destroy(err) might have been called
  //   // before coming here and have an 'error' scheduled. In the
  //   // case of socket.destroy() below this 'error' has no handler
  //   // and could cause unhandled exception.

  //   if (!socket.writable) {
  //     socket.destroy();
  //     return;
  //   }

  //   const requests = this.requests[name];
  //   if (requests?.length) {
  //     const req = requests.shift();
  //     const reqAsyncRes = req[kRequestAsyncSnapshot];
  //     if (reqAsyncRes) {
  //       // Run request within the original async context.
  //       reqAsyncRes(() => {
  //         asyncResetHandle(socket);
  //         setRequestSocket(this, req, socket);
  //       });
  //       req[kRequestAsyncSnapshot] = null;
  //     } else {
  //       setRequestSocket(this, req, socket);
  //     }
  //     if (requests.length === 0) {
  //       delete this.requests[name];
  //     }
  //     return;
  //   }

  //   // If there are no pending requests, then put it in
  //   // the freeSockets pool, but only if we're allowed to do so.
  //   const req = socket._httpMessage;
  //   if (!req || !req.shouldKeepAlive || !this.keepAlive) {
  //     socket.destroy();
  //     return;
  //   }

  //   const freeSockets = this.freeSockets[name] || [];
  //   const freeLen = freeSockets.length;
  //   let count = freeLen;
  //   if (this.sockets[name])
  //     count += this.sockets[name].length;

  //   if (this.totalSocketCount > this.maxTotalSockets ||
  //       count > this.maxSockets ||
  //       freeLen >= this.maxFreeSockets ||
  //       !this.keepSocketAlive(socket)) {
  //     socket.destroy();
  //     return;
  //   }

  //   this.freeSockets[name] = freeSockets;
  //   socket[async_id_symbol] = -1;
  //   socket._httpMessage = null;
  //   this.removeSocket(socket, options);

  //   socket.once('error', freeSocketErrorListener);
  //   freeSockets.push(socket);
  // });

  // Don't emit keylog events unless there is a listener for them.
  // this.on('newListener', maybeEnableKeylog);
}
$toClass(Agent, "Agent", EventEmitter);

var globalAgent;
Object.defineProperty(Agent, "globalAgent", {
  get: function () {
    return globalAgent;
  },
});

Agent.defaultMaxSockets = Infinity;

// Agent.prototype.createConnection = net.createConnection;
Agent.prototype.createConnection = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createConnection is a no-op, returns fake socket");
  return (this[kFakeSocket] ??= new FakeSocket());
};

// Get the key for a given set of request options
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

Agent.prototype.createSocket = function (req, options, cb) {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createSocket returns fake socket");
  cb(null, (this[kFakeSocket] ??= new FakeSocket()));
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

globalAgent = new Agent({ keepAlive: true, scheduling: 'lifo', timeout: 5000 });
export default {
  Agent,
  globalAgent,
}