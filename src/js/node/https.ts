// Hardcoded module "node:https"

const http = require("node:http");
const { urlToHttpOptions } = require("internal/url");
const { kEmptyObject, once } = require("internal/shared");
const { kProxyConfig, checkShouldUseProxy, kWaitForProxyTunnel } = require("internal/http");
const tls = require("node:tls");
const net = require("node:net");

const ArrayPrototypeShift = Array.prototype.shift;
const ObjectAssign = Object.assign;
const ArrayPrototypeUnshift = Array.prototype.unshift;

function request(...args) {
  let options: any = {};

  if (typeof args[0] === "string") {
    const urlStr = ArrayPrototypeShift.$call(args);
    options = urlToHttpOptions(new URL(urlStr));
  } else if (args[0] instanceof URL) {
    options = urlToHttpOptions(ArrayPrototypeShift.$call(args));
  }

  if (args[0] && typeof args[0] !== "function") {
    ObjectAssign.$call(null, options, ArrayPrototypeShift.$call(args));
  }

  options._defaultAgent = globalAgent;
  ArrayPrototypeUnshift.$call(args, options);

  return new http.ClientRequest(...args);
}

function get(input, options, cb) {
  const req = request(input, options, cb);
  req.end();
  return req;
}

// When proxying a HTTPS request, the following needs to be done:
// https://datatracker.ietf.org/doc/html/rfc9110#CONNECT
// 1. Send a CONNECT request to the proxy server.
// 2. Wait for 200 connection established response to establish the tunnel.
// 3. Perform TLS handshake with the endpoint over the socket.
// 4. Tunnel the request using the established connection.
//
// This function computes the tunnel configuration for HTTPS requests.
// The handling of the tunnel connection is done in createConnection.
function getTunnelConfigForProxiedHttps(agent, reqOptions) {
  if (!agent[kProxyConfig]) return null;
  if ((reqOptions.protocol || agent.protocol) !== "https:") return null;
  const shouldUseProxy = checkShouldUseProxy(agent[kProxyConfig], reqOptions);
  $debug(`getTunnelConfigForProxiedHttps should use proxy for ${reqOptions.host}:${reqOptions.port}:`, shouldUseProxy);
  if (!shouldUseProxy) return null;
  const { auth, href } = agent[kProxyConfig];
  // The request is a HTTPS request, assemble the payload for establishing the tunnel.
  const ipType = net.isIP(reqOptions.host);
  // The request target must put IPv6 address in square brackets.
  // Here reqOptions is already processed by urlToHttpOptions so we'll add them back if necessary.
  // See https://www.rfc-editor.org/rfc/rfc3986#section-3.2.2
  const requestHost = ipType === 6 ? `[${reqOptions.host}]` : reqOptions.host;
  const requestPort = reqOptions.port || agent.defaultPort;
  const endpoint = `${requestHost}:${requestPort}`;
  // The ClientRequest constructor should already have validated the host and the port.
  // When the request options come from a string invalid characters would be stripped away,
  // when it's an object ERR_INVALID_CHAR would be thrown. Here we just assert in case
  // agent.createConnection() is called with invalid options.
  $assert(!endpoint.includes("\r"));
  $assert(!endpoint.includes("\n"));

  let payload = `CONNECT ${endpoint} HTTP/1.1\r\n`;
  if (auth) payload += `proxy-authorization: ${auth}\r\n`;
  if (agent.keepAlive || agent.maxSockets !== Infinity) payload += "proxy-connection: keep-alive\r\n";
  payload += `host: ${endpoint}`;
  payload += "\r\n\r\n";

  const result = {
    __proto__: null,
    proxyTunnelPayload: payload,
    requestOptions: {
      __proto__: null,
      servername: reqOptions.servername || ipType ? undefined : reqOptions.host,
      ...reqOptions,
    },
  };
  $debug(`updated request for HTTPS proxy ${href} with`, result);
  return result;
}

function establishTunnel(agent, socket, options, tunnelConfig, afterSocket) {
  const { proxyTunnelPayload } = tunnelConfig;
  // By default, the socket is in paused mode. Read to look for the 200 connection established response.
  function read() {
    let chunk;
    while ((chunk = socket.read()) !== null) {
      if (onProxyData(chunk) !== -1) {
        break;
      }
    }
    socket.on("readable", read);
  }

  function cleanup() {
    socket.removeListener("end", onProxyEnd);
    socket.removeListener("error", onProxyError);
    socket.removeListener("readable", read);
    socket.setTimeout(0); // Clear the timeout for the tunnel establishment.
  }

  function onProxyError(err) {
    $debug("onProxyError", err);
    cleanup();
    afterSocket(err, socket);
  }

  // Read the headers from the chunks and check for the status code. If it fails we
  // clean up the socket and return an error. Otherwise we establish the tunnel.
  let buffer = "";
  function onProxyData(chunk) {
    const str = chunk.toString();
    $debug("onProxyData", str);
    buffer += str;
    const headerEndIndex = buffer.indexOf("\r\n\r\n");
    if (headerEndIndex === -1) return headerEndIndex;
    const statusLine = buffer.substring(0, buffer.indexOf("\r\n"));
    const statusCode = statusLine.split(" ")[1];
    if (statusCode !== "200") {
      $debug(`onProxyData receives ${statusCode}, cleaning up`);
      cleanup();
      const targetHost = proxyTunnelPayload.split("\r")[0].split(" ")[1];
      const message = `Failed to establish tunnel to ${targetHost} via ${agent[kProxyConfig].href}: ${statusLine}`;
      const err = $ERR_PROXY_TUNNEL(message);
      // @ts-expect-error
      err.statusCode = Number.parseInt(statusCode);
      afterSocket(err, socket);
    } else {
      // https://datatracker.ietf.org/doc/html/rfc9110#CONNECT
      // RFC 9110 says that it can be 2xx but in the real world, proxy clients generally only accepts 200.
      // Proxy servers are not supposed to send anything after the headers - the payload must be
      // be empty. So after this point we will proceed with the tunnel e.g. starting TLS handshake.
      $debug("onProxyData receives 200, establishing tunnel");
      cleanup();

      // Reuse the tunneled socket to perform the TLS handshake with the endpoint, then send the request.
      const { requestOptions } = tunnelConfig;
      tunnelConfig.requestOptions = null;
      requestOptions.socket = socket;
      let tunneldSocket;
      const onTLSHandshakeError = err => {
        $debug("Propagate error event from tunneled socket to tunnel socket");
        afterSocket(err, tunneldSocket);
      };
      tunneldSocket = tls.connect(requestOptions, () => {
        $debug("TLS handshake over tunnel succeeded");
        tunneldSocket.removeListener("error", onTLSHandshakeError);
        afterSocket(null, tunneldSocket);
      });
      tunneldSocket.on("free", () => {
        $debug("Propagate free event from tunneled socket to tunnel socket");
        socket.emit("free");
      });
      tunneldSocket.on("error", onTLSHandshakeError);
    }
    return headerEndIndex;
  }

  function onProxyEnd() {
    cleanup();
    const err = $ERR_PROXY_TUNNEL("Connection to establish proxy tunnel ended unexpectedly");
    afterSocket(err, socket);
  }

  const proxyTunnelTimeout = tunnelConfig.requestOptions.timeout;
  $debug("proxyTunnelTimeout", proxyTunnelTimeout, options.timeout);
  // It may be worth a separate timeout error/event.
  // But it also makes sense to treat the tunnel establishment timeout as a normal timeout for the request.
  function onProxyTimeout() {
    $debug("onProxyTimeout", proxyTunnelTimeout);
    cleanup();
    const err = $ERR_PROXY_TUNNEL(`Connection to establish proxy tunnel timed out after ${proxyTunnelTimeout}ms`);
    // @ts-expect-error
    err.proxyTunnelTimeout = proxyTunnelTimeout;
    afterSocket(err, socket);
  }

  if (proxyTunnelTimeout && proxyTunnelTimeout > 0) {
    $debug("proxy tunnel setTimeout", proxyTunnelTimeout);
    socket.setTimeout(proxyTunnelTimeout, onProxyTimeout);
  }

  socket.on("error", onProxyError);
  socket.on("end", onProxyEnd);
  socket.write(proxyTunnelPayload);

  read();
}

// HTTPS agents.
// See ProxyConfig in src/js/internal/http.ts for how the connection should be handled when the agent is configured to use a proxy server.
function createConnection(...args) {
  // XXX: This signature (port, host, options) is different from all the other createConnection() methods.
  let options, cb;
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
  if (typeof args[args.length - 1] === "function") {
    cb = args[args.length - 1];
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

  let socket;
  const tunnelConfig = getTunnelConfigForProxiedHttps(this, options);
  $debug(`https createConnection should use proxy for ${options.host}:${options.port}:`, tunnelConfig);

  if (!tunnelConfig) {
    socket = tls.connect(options);
  } else {
    const connectOptions = {
      ...this[kProxyConfig].proxyConnectionOptions,
    };
    $debug("Create proxy socket", connectOptions);
    const onError = err => {
      cleanupAndPropagate(err, socket);
    };
    const proxyTunnelTimeout = tunnelConfig.requestOptions.timeout;
    const onTimeout = () => {
      const err = $ERR_PROXY_TUNNEL(`Connection to establish proxy tunnel timed out after ${proxyTunnelTimeout}ms`);
      // @ts-expect-error
      err.proxyTunnelTimeout = proxyTunnelTimeout;
      cleanupAndPropagate(err, socket);
    };
    const cleanupAndPropagate = once((err, currentSocket) => {
      $debug("cleanupAndPropagate", err);
      socket.removeListener("error", onError);
      socket.removeListener("timeout", onTimeout);
      // An error occurred during tunnel establishment, in that case just destroy the socket and propagate the error to the callback.

      // When the error comes from unexpected status code, the stream is still in good shape,
      // in that case let req.onSocket handle the destruction instead.
      if (err && err.code === "ERR_PROXY_TUNNEL" && !err.statusCode) {
        socket.destroy();
      }
      // This error should go to:
      // -> oncreate in Agent.prototype.createSocket
      // -> closure in Agent.prototype.addRequest or Agent.prototype.removeSocket
      if (cb) {
        cb(err, currentSocket);
      }
    });
    const onProxyConnection = () => {
      socket.removeListener("error", onError);
      establishTunnel(this, socket, options, tunnelConfig, cleanupAndPropagate);
    };
    if (this[kProxyConfig].protocol === "http:") {
      socket = net.connect(connectOptions, onProxyConnection);
    } else {
      socket = tls.connect(connectOptions, onProxyConnection);
    }

    socket.on("error", onError);
    if (proxyTunnelTimeout) {
      socket.setTimeout(proxyTunnelTimeout, onTimeout);
    }
    socket[kWaitForProxyTunnel] = true;
  }

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

type Agent = import("node:https").Agent;
function Agent(options): void {
  if (!(this instanceof Agent)) return new Agent(options);

  options = { __proto__: null, ...options };
  options.defaultPort ??= 443;
  options.protocol ??= "https:";
  http.Agent.$call(this, options);

  this.maxCachedSessions = this.options.maxCachedSessions;
  if (this.maxCachedSessions === undefined) this.maxCachedSessions = 100;

  this._sessionCache = {
    map: {},
    list: [],
  };
}
$toClass(Agent, "Agent", http.Agent);

Agent.prototype.createConnection = createConnection;

Agent.prototype.getName = function getName(options = kEmptyObject) {
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
  if (options.sigalgs) name += JSON.stringify(options.sigalgs);
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
  // Cache is disabled
  if (this.maxCachedSessions === 0) {
    return;
  }
  // Fast case - update existing entry
  if (this._sessionCache.map[key]) {
    this._sessionCache.map[key] = session;
    return;
  }
  // Put new entry
  if (this._sessionCache.list.length >= this.maxCachedSessions) {
    const oldKey = this._sessionCache.list.shift();
    $debug("evicting %j", oldKey);
    delete this._sessionCache.map[oldKey];
  }
  this._sessionCache.list.push(key);
  this._sessionCache.map[key] = session;
};

Agent.prototype._evictSession = function _evictSession(key) {
  const index = this._sessionCache.list.indexOf(key);
  if (index === -1) return;
  this._sessionCache.list.splice(index, 1);
  delete this._sessionCache.map[key];
};

const globalAgent = new Agent({
  keepAlive: true,
  scheduling: "lifo",
  timeout: 5000,
  // This normalized from both --use-env-proxy and NODE_USE_ENV_PROXY settings.
  // proxyEnv: getOptionValue("--use-env-proxy") ? filterEnvForProxies(process.env) : undefined,
  proxyEnv: undefined, // TODO:
});

export default {
  Agent,
  globalAgent,
  Server: http.Server,
  createServer: http.createServer,
  get,
  request,
};
