const EventEmitter = require("node:events");
const { parseProxyConfigFromEnv, kProxyConfig, checkShouldUseProxy, kWaitForProxyTunnel } = require("internal/http");
const { getLazy, kEmptyObject, once } = require("internal/shared");
const { validateNumber, validateOneOf, validateString } = require("internal/validators");
const { isIP } = require("internal/net/isIP");

const kOnKeylog = Symbol("onkeylog");
const kRequestOptions = Symbol("requestOptions");

function freeSocketErrorListener(err) {
  const socket = this;
  $debug("SOCKET ERROR on FREE socket:", err.message, err.stack);
  socket.destroy();
  socket.emit("agentRemove");
}

type Agent = import("node:http").Agent;
function Agent(options): void {
  if (!(this instanceof Agent)) return new Agent(options);

  EventEmitter.$call(this);

  this.options = { __proto__: null, ...options };

  this.defaultPort = this.options.defaultPort || 80;
  this.protocol = this.options.protocol || "http:";

  if (this.options.noDelay === undefined) this.options.noDelay = true;

  // Don't confuse node:net and make it think that we're connecting to a pipe
  this.options.path = null;
  this.requests = { __proto__: null };
  this.sockets = { __proto__: null };
  this.freeSockets = { __proto__: null };
  this.keepAliveMsecs = this.options.keepAliveMsecs || 1000;
  this.keepAlive = this.options.keepAlive || false;
  this.maxSockets = this.options.maxSockets || Agent.defaultMaxSockets;
  this.maxFreeSockets = this.options.maxFreeSockets || 256;
  this.scheduling = this.options.scheduling || "lifo";
  this.maxTotalSockets = this.options.maxTotalSockets;
  this.totalSocketCount = 0;

  this.agentKeepAliveTimeoutBuffer =
    typeof this.options.agentKeepAliveTimeoutBuffer === "number" &&
    this.options.agentKeepAliveTimeoutBuffer >= 0 &&
    Number.isFinite(this.options.agentKeepAliveTimeoutBuffer)
      ? this.options.agentKeepAliveTimeoutBuffer
      : 1000;

  const proxyEnv = this.options.proxyEnv;
  if (typeof proxyEnv === "object" && proxyEnv !== null) {
    this[kProxyConfig] = parseProxyConfigFromEnv(proxyEnv, this.protocol, this.keepAlive);
    $debug(`new ${this.protocol} agent with proxy config`, this[kProxyConfig]);
  }

  validateOneOf(this.scheduling, "scheduling", ["fifo", "lifo"]);

  if (this.maxTotalSockets !== undefined) {
    validateNumber(this.maxTotalSockets, "maxTotalSockets", 1);
  } else {
    this.maxTotalSockets = Infinity;
  }

  this.on("free", (socket, options) => {
    const name = this.getName(options);
    $debug("agent.on(free)", name);

    // TODO: socket.destroy(err) might have been called before coming here and have an 'error' scheduled.
    // In the case of socket.destroy() below this 'error' has no handler and could cause unhandled exception.
    if (!socket.writable) {
      socket.destroy();
      return;
    }

    const requests = this.requests[name];
    if (requests?.length) {
      const req = requests.shift();
      setRequestSocket(this, req, socket);
      if (requests.length === 0) {
        delete this.requests[name];
      }
      return;
    }

    // If there are no pending requests, then put it in the freeSockets pool, but only if we're allowed to do so.
    const req = socket._httpMessage;
    if (!req || !req.shouldKeepAlive || !this.keepAlive) {
      socket.destroy();
      return;
    }

    const freeSockets = this.freeSockets[name] || [];
    const freeLen = freeSockets.length;
    let count = freeLen;
    if (this.sockets[name]) count += this.sockets[name].length;

    if (
      this.totalSocketCount > this.maxTotalSockets ||
      count > this.maxSockets ||
      freeLen >= this.maxFreeSockets ||
      !this.keepSocketAlive(socket)
    ) {
      socket.destroy();
      return;
    }

    this.freeSockets[name] = freeSockets;
    socket._httpMessage = null;
    this.removeSocket(socket, options);

    socket.once("error", freeSocketErrorListener);
    freeSockets.push(socket);
  });

  // Don't emit keylog events unless there is a listener for them.
  this.on("newListener", maybeEnableKeylog);
}
$toClass(Agent, "Agent", EventEmitter);

function maybeEnableKeylog(this: Agent, eventName) {
  if (eventName === "keylog") {
    this.removeListener("newListener", maybeEnableKeylog);
    // Future sockets will listen on keylog at creation.
    const agent = this;
    this[kOnKeylog] = function onkeylog(keylog) {
      agent.emit("keylog", keylog, this);
    };
    // Existing sockets will start listening on keylog now.
    const sockets = Object.values(this.sockets);
    for (let i = 0; i < sockets.length; i++) {
      sockets[i]!.on("keylog", this[kOnKeylog]);
    }
  }
}

const tls = getLazy(() => require("node:tls"));
const net = getLazy(() => require("node:net"));

Agent.defaultMaxSockets = Infinity;

Agent.prototype.createConnection = function createConnection(...args) {
  const normalized = net()._normalizeArgs(args);
  const options = normalized[0];
  const cb = normalized[1];

  const shouldUseProxy = checkShouldUseProxy(this[kProxyConfig], options);
  $debug(`http createConnection should use proxy for ${options.host}:${options.port}:`, shouldUseProxy);
  if (!shouldUseProxy) {
    // @ts-ignore
    return net().createConnection(...args);
  }

  const connectOptions = {
    ...this[kProxyConfig].proxyConnectionOptions,
  };
  const proxyProtocol = this[kProxyConfig].protocol;
  if (proxyProtocol === "http:") {
    // @ts-ignore
    return net().connect(connectOptions, cb);
  } else if (proxyProtocol === "https:") {
    // @ts-ignore
    return tls().connect(connectOptions, cb);
  }
  // This should be unreachable because proxy config should be null for other protocols.
  $assert(false, `Unexpected proxy protocol ${proxyProtocol}`);
};

Agent.prototype.getName = function getName(options = kEmptyObject) {
  let name = options.host || "localhost";

  name += ":";
  if (options.port) name += options.port;

  name += ":";
  if (options.localAddress) name += options.localAddress;

  // Pacify parallel/test-http-agent-getname by only appending the ':' when options.family is set.
  if (options.family === 4 || options.family === 6) name += `:${options.family}`;

  if (options.socketPath) name += `:${options.socketPath}`;

  return name;
};

function handleSocketAfterProxy(err, req) {
  if (err.code === "ERR_PROXY_TUNNEL") {
    if (err.proxyTunnelTimeout) {
      req.emit("timeout"); // Propagate the timeout from the tunnel to the request.
    } else {
      req.emit("error", err);
    }
  }
}

Agent.prototype.addRequest = function addRequest(req, options, port /* legacy */, localAddress /* legacy */) {
  $debug("WARN: Agent.addRequest is a no-op");
  return; // TODO:

  // Legacy API: addRequest(req, host, port, localAddress)
  if (typeof options === "string") {
    options = {
      __proto__: null,
      host: options,
      port,
      localAddress,
    };
  }

  // Here the agent options will override per-request options.
  options = { __proto__: null, ...options, ...this.options };
  if (options.socketPath) options.path = options.socketPath;

  normalizeServerName(options, req);

  const name = this.getName(options);
  this.sockets[name] ||= [];

  const freeSockets = this.freeSockets[name];
  let socket;
  if (freeSockets) {
    while (freeSockets.length && freeSockets[0].destroyed) {
      freeSockets.shift();
    }
    socket = this.scheduling === "fifo" ? freeSockets.shift() : freeSockets.pop();
    if (!freeSockets.length) delete this.freeSockets[name];
  }

  const freeLen = freeSockets ? freeSockets.length : 0;
  const sockLen = freeLen + this.sockets[name].length;

  if (socket) {
    this.reuseSocket(socket, req);
    setRequestSocket(this, req, socket);
    this.sockets[name].push(socket);
  } else if (sockLen < this.maxSockets && this.totalSocketCount < this.maxTotalSockets) {
    this.createSocket(req, options, (err, socket) => {
      if (err) {
        handleSocketAfterProxy(err, req);
        $debug("call onSocket", sockLen, freeLen);
        req.onSocket(socket, err);
        return;
      }
      setRequestSocket(this, req, socket);
    });
  } else {
    $debug("wait for socket");
    this.requests[name] ||= [];
    req[kRequestOptions] = options;
    this.requests[name].push(req);
  }
};

Agent.prototype.createSocket = function createSocket(req, options, cb) {
  options = { __proto__: null, ...options, ...this.options };
  if (options.socketPath) options.path = options.socketPath;

  normalizeServerName(options, req);

  // Make sure per-request timeout is respected.
  const timeout = req.timeout || this.options.timeout || undefined;
  if (timeout) {
    options.timeout = timeout;
  }

  const name = this.getName(options);
  options._agentKey = name;

  $debug("createConnection", name);
  options.encoding = null;

  const oncreate = once((err, s) => {
    if (err) return cb(err);
    this.sockets[name] ||= [];
    this.sockets[name].push(s);
    this.totalSocketCount++;
    $debug("sockets", name, this.sockets[name].length, this.totalSocketCount);
    installListeners(this, s, options);
    cb(null, s);
  });
  if (this.keepAlive) {
    options.keepAlive = this.keepAlive;
    options.keepAliveInitialDelay = this.keepAliveMsecs;
  }

  const newSocket = this.createConnection(options, oncreate);
  if (newSocket && !newSocket[kWaitForProxyTunnel]) oncreate(null, newSocket);
};

function normalizeServerName(options, req) {
  if (!options.servername && options.servername !== "") options.servername = calculateServerName(options, req);
}

function calculateServerName(options, req) {
  let servername = options.host;
  const hostHeader = req.getHeader("host");
  if (hostHeader) {
    validateString(hostHeader, "options.headers.host");

    // abc => abc
    // abc:123 => abc
    // [::1] => ::1
    // [::1]:123 => ::1
    if (hostHeader[0] === "[") {
      const index = hostHeader.indexOf("]");
      if (index === -1) {
        // Leading '[', but no ']'. Need to do something...
        servername = hostHeader;
      } else {
        servername = hostHeader.substring(1, index);
      }
    } else {
      servername = hostHeader.split(":", 1)[0];
    }
  }
  // Don't implicitly set invalid (IP) servernames.
  if (isIP(servername)) servername = "";
  return servername;
}

function installListeners(agent, s, options) {
  function onFree() {
    $debug("CLIENT socket onFree");
    agent.emit("free", s, options);
  }
  s.on("free", onFree);

  function onClose() {
    $debug("CLIENT socket onClose");
    // This is the only place where sockets get removed from the Agent.
    // If you want to remove a socket from the pool, just close it.
    // All socket errors end in a close event anyway.
    agent.totalSocketCount--;
    agent.removeSocket(s, options);
  }
  s.on("close", onClose);

  function onTimeout() {
    $debug("CLIENT socket onTimeout");

    const sockets = agent.freeSockets;
    if (Object.keys(sockets).some(name => sockets[name].includes(s))) {
      return s.destroy();
    }
  }
  s.on("timeout", onTimeout);

  function onRemove() {
    $debug("CLIENT socket onRemove");
    agent.totalSocketCount--;
    agent.removeSocket(s, options);
    s.removeListener("close", onClose);
    s.removeListener("free", onFree);
    s.removeListener("timeout", onTimeout);
    s.removeListener("agentRemove", onRemove);
  }
  s.on("agentRemove", onRemove);

  if (agent[kOnKeylog]) {
    s.on("keylog", agent[kOnKeylog]);
  }
}

Agent.prototype.removeSocket = function removeSocket(s, options) {
  const name = this.getName(options);
  $debug("removeSocket", name, "writable:", s.writable);
  const sets = [this.sockets];

  if (!s.writable) sets.push(this.freeSockets);

  for (let sk = 0; sk < sets.length; sk++) {
    const sockets = sets[sk];
    const socket = sockets[name];

    if (socket) {
      const index = socket.indexOf(s);
      if (index !== -1) {
        socket.splice(index, 1);
        if (socket.length === 0) delete sockets[name];
      }
    }
  }

  let req;
  if (this.requests[name]?.length) {
    $debug("removeSocket, have a request, make a socket");
    req = this.requests[name][0];
  } else {
    const keys = Object.keys(this.requests);
    for (let i = 0; i < keys.length; i++) {
      const prop = keys[i];
      if (this.sockets[prop]?.length) break;
      $debug("removeSocket, have a request with different origin, make a socket");
      req = this.requests[prop][0];
      options = req[kRequestOptions];
      break;
    }
  }

  if (req && options) {
    req[kRequestOptions] = undefined;
    this.createSocket(req, options, (err, socket) => {
      if (err) {
        handleSocketAfterProxy(err, req);
        req.onSocket(null, err);
        return;
      }

      socket.emit("free");
    });
  }
};

Agent.prototype.keepSocketAlive = function keepSocketAlive(socket) {
  socket.setKeepAlive(true, this.keepAliveMsecs);
  socket.unref();

  let agentTimeout = this.options.timeout || 0;
  let canKeepSocketAlive = true;
  const res = socket._httpMessage?.res;

  if (res) {
    const keepAliveHint = res.headers["keep-alive"];

    if (keepAliveHint) {
      const hint = /^timeout=(\d+)/.exec(keepAliveHint)?.[1];

      if (hint) {
        // Let the timer expire before the announced timeout to reduce the likelihood of ECONNRESET errors
        let serverHintTimeout = Number.parseInt(hint) * 1000 - this.agentKeepAliveTimeoutBuffer;
        serverHintTimeout = serverHintTimeout > 0 ? serverHintTimeout : 0;
        if (serverHintTimeout === 0) {
          // Cannot safely reuse the socket because the server timeout is too short
          canKeepSocketAlive = false;
        } else if (serverHintTimeout < agentTimeout) {
          agentTimeout = serverHintTimeout;
        }
      }
    }
  }

  if (socket.timeout !== agentTimeout) {
    socket.setTimeout(agentTimeout);
  }

  return canKeepSocketAlive;
};

Agent.prototype.reuseSocket = function reuseSocket(socket, req) {
  $debug("have free socket");
  socket.removeListener("error", freeSocketErrorListener);
  req.reusedSocket = true;
  socket.ref();
};

Agent.prototype.destroy = function destroy() {
  const sets = [this.freeSockets, this.sockets];
  for (let s = 0; s < sets.length; s++) {
    const set = sets[s];
    const keys = Object.keys(set);
    for (let v = 0; v < keys.length; v++) {
      const setName = set[keys[v]];
      for (let n = 0; n < setName.length; n++) {
        setName[n].destroy();
      }
    }
  }
};

function setRequestSocket(agent, req, socket) {
  req.onSocket(socket);
  const agentTimeout = agent.options.timeout || 0;
  if (req.timeout === undefined || req.timeout === agentTimeout) {
    return;
  }
  socket.setTimeout(req.timeout);
}

export default {
  Agent,
  globalAgent: new Agent({
    keepAlive: true,
    scheduling: "lifo",
    timeout: 5000,
    // This normalized from both --use-env-proxy and NODE_USE_ENV_PROXY settings.
    // proxyEnv: getOptionValue("--use-env-proxy") ? filterEnvForProxies(process.env) : undefined,
    proxyEnv: undefined, // TODO:
  }),
};
