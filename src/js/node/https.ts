// Hardcoded module "node:https"
// The client portions (Agent, request, get) are a port of Node.js's lib/https.js
// https://github.com/nodejs/node/blob/v26.3.0/lib/https.js
const http = require("node:http");
const tls = require("node:tls");
const { isIP } = require("node:net");
const net = require("node:net");
const { urlToHttpOptions } = require("internal/url");
const { kEmptyObject, once } = require("internal/shared");
const { validateObject } = require("internal/validators");
const { kProxyConfig, checkShouldUseProxy, kWaitForProxyTunnel } = require("internal/http");
const { validateHeaderValue } = require("node:_http_common");

const ArrayPrototypeShift = Array.prototype.shift;
const ObjectAssign = Object.assign;
const ArrayPrototypeUnshift = Array.prototype.unshift;
const JSONStringify = JSON.stringify;

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

// HTTPS agents.
// See ProxyConfig in internal/http.ts for how the connection should be handled
// when the agent is configured to use a proxy server. Port of Node.js's
// getTunnelConfigForProxiedHttps() and establishTunnel():
// https://github.com/nodejs/node/blob/v26.3.0/lib/https.js
function getTunnelConfigForProxiedHttps(agent, reqOptions) {
  if (agent[kProxyConfig] === undefined || agent[kProxyConfig] === null) {
    return null;
  }
  if ((reqOptions.protocol || agent.protocol) !== "https:") {
    return null;
  }
  const shouldUseProxy = checkShouldUseProxy(agent[kProxyConfig], reqOptions);
  $debug(`getTunnelConfigForProxiedHttps should use proxy for ${reqOptions.host}:${reqOptions.port}:`, shouldUseProxy);
  if (shouldUseProxy === false || shouldUseProxy === null || shouldUseProxy === undefined) {
    return null;
  }
  const { auth } = agent[kProxyConfig];
  // The request is a HTTPS request, assemble the payload for establishing the tunnel.
  const ipType = isIP(reqOptions.host);
  // The request target must put IPv6 address in square brackets.
  // Here reqOptions is already processed by urlToHttpOptions so we'll add them back if necessary.
  // See https://www.rfc-editor.org/rfc/rfc3986#section-3.2.2
  const requestHost = ipType === 6 ? `[${reqOptions.host}]` : reqOptions.host;
  const requestPort = reqOptions.port || agent.defaultPort;
  const endpoint = `${requestHost}:${requestPort}`;
  // The ClientRequest constructor should already have validated the host and the port.
  // When the request options come from a string invalid characters would be stripped away,
  // when it's an object ERR_INVALID_CHAR would be thrown. Validate again in case
  // agent.createConnection() is called with invalid options.
  validateHeaderValue("host", endpoint);

  let payload = `CONNECT ${endpoint} HTTP/1.1\r\n`;
  // The parseProxyConfigFromEnv() method should have already validated the authorization header
  // value.
  if (auth) {
    payload += `proxy-authorization: ${auth}\r\n`;
  }
  if (agent.keepAlive || agent.maxSockets !== Infinity) {
    payload += "proxy-connection: keep-alive\r\n";
  }
  payload += `host: ${endpoint}`;
  payload += "\r\n\r\n";

  const result = {
    __proto__: null,
    proxyTunnelPayload: payload,
    requestOptions: {
      // Options used for the request sent after the tunnel is established.
      __proto__: null,
      // Dead today (the spread below always carries a servername set by
      // normalizeServerName), kept for upstream parity - parenthesized so the
      // fallback reads as intended if it ever becomes live. Upstream parses
      // this as `(servername || ipType) ? undefined : host`.
      servername: reqOptions.servername || (ipType ? undefined : reqOptions.host),
      ...reqOptions,
    },
  };
  return result;
}

function establishTunnel(agent, socket, options, tunnelConfig, afterSocket) {
  const { proxyTunnelPayload } = tunnelConfig;
  // Once the tunnel outcome is decided the raw socket belongs to the TLS
  // wrap; stop reading from it and never re-register the readable listener.
  let tunnelDone = false;
  // By default, the socket is in paused mode. Read to look for the 200
  // connection established response.
  function read() {
    let chunk;
    while (tunnelDone === false && (chunk = socket.read()) !== null) {
      if (onProxyData(chunk) !== -1) {
        break;
      }
    }
    if (tunnelDone === false) {
      // once(), not on(): read() re-registers on every incomplete pass, so a
      // persistent listener would double per fragmented response chunk and
      // cleanup()'s single removeListener would leave the extras attached.
      socket.once("readable", read);
    }
  }

  function cleanup() {
    tunnelDone = true;
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
      err.statusCode = parseInt(statusCode);
      afterSocket(err, socket);
    } else {
      // https://datatracker.ietf.org/doc/html/rfc9110#CONNECT
      // RFC 9110 says that it can be 2xx but in the real world, proxy clients generally only
      // accepts 200.
      // Proxy servers are not supposed to send anything after the headers - the payload must be
      // be empty. So after this point we will proceed with the tunnel e.g. starting TLS handshake.
      $debug("onProxyData receives 200, establishing tunnel");
      cleanup();

      // Reuse the tunneled socket to perform the TLS handshake with the endpoint,
      // then send the request.
      const { requestOptions } = tunnelConfig;
      tunnelConfig.requestOptions = null;
      requestOptions.socket = socket;
      let tunneledSocket;
      function onTLSHandshakeError(err) {
        $debug("Propagate error event from tunneled socket to tunnel socket");
        afterSocket(err, tunneledSocket);
      }
      function onTLSHandshakeSuccess() {
        $debug("TLS handshake over tunnel succeeded");
        tunneledSocket.removeListener("error", onTLSHandshakeError);
        afterSocket(null, tunneledSocket);
      }
      function onTunneledSocketFree() {
        $debug("Propagate free event from tunneled socket to tunnel socket");
        socket.emit("free");
      }
      tunneledSocket = tls.connect(requestOptions, onTLSHandshakeSuccess);
      tunneledSocket.on("free", onTunneledSocketFree);
      tunneledSocket.on("error", onTLSHandshakeError);
      const agentKey = requestOptions._agentKey;
      if (agentKey) {
        // The tunneled socket carries the TLS session with the target; cache
        // it (and evict on close) under the target's agent key.
        tunneledSocket.on("session", onSocketSession.bind(agent, agentKey));
        tunneledSocket.once("close", onSocketClose.bind(agent, agentKey));
      }
    }
    return headerEndIndex;
  }

  function onProxyEnd() {
    cleanup();
    const err = $ERR_PROXY_TUNNEL("Connection to establish proxy tunnel ended unexpectedly");
    afterSocket(err, socket);
  }

  const proxyTunnelTimeout = tunnelConfig.requestOptions.timeout;
  // It may be worth a separate timeout error/event.
  // But it also makes sense to treat the tunnel establishment timeout as
  // a normal timeout for the request.
  function onProxyTimeout() {
    $debug("onProxyTimeout", proxyTunnelTimeout);
    cleanup();
    const err = $ERR_PROXY_TUNNEL(`Connection to establish proxy tunnel timed out after ${proxyTunnelTimeout}ms`);
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

function createConnection(...args) {
  // XXX: This signature (port, host, options) is different from all the other
  // createConnection() methods. The trailing callback argument is only used
  // by Node.js's proxy tunneling.
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
  let cb;
  const lastArg = args[args.length - 1];
  if (typeof lastArg === "function") {
    cb = lastArg;
  }

  $debug("https createConnection", options);

  const agentKey = options._agentKey;
  if (agentKey) {
    const session = this._getSession(agentKey);
    if (session) {
      $debug("reuse session for %j", agentKey);
      options = {
        session,
        ...options,
      };
    }
  }

  let socket;
  const tunnelConfig = getTunnelConfigForProxiedHttps(this, options);

  if (tunnelConfig === null) {
    socket = tls.connect(options);
  } else {
    const connectOptions = {
      ...this[kProxyConfig].proxyConnectionOptions,
    };
    $debug("Create proxy socket", connectOptions);
    const agent = this;
    function onError(err) {
      cleanupAndPropagate(err, socket);
    }
    const proxyTunnelTimeout = tunnelConfig.requestOptions.timeout;
    function onTimeout() {
      const err = $ERR_PROXY_TUNNEL(`Connection to establish proxy tunnel timed out after ${proxyTunnelTimeout}ms`);
      err.proxyTunnelTimeout = proxyTunnelTimeout;
      cleanupAndPropagate(err, socket);
    }
    const cleanupAndPropagate = once(function cleanupAndPropagateImpl(err, currentSocket) {
      $debug("cleanupAndPropagate", err);
      socket.removeListener("error", onError);
      socket.removeListener("timeout", onTimeout);
      // An error occurred during tunnel establishment, in that case just destroy the socket
      // and propagate the error to the callback.

      // When the error comes from unexpected status code, the stream is still in good shape,
      // in that case let req.onSocket handle the destruction instead.
      if (err && err.code === "ERR_PROXY_TUNNEL" && err.statusCode === undefined) {
        socket.destroy();
      }
      // This error should go to:
      // -> oncreate in Agent.prototype.createSocket
      // -> closure in Agent.prototype.addRequest or Agent.prototype.removeSocket
      if (cb) {
        cb(err, currentSocket);
      }
    });
    function onProxyConnection() {
      socket.removeListener("error", onError);
      establishTunnel(agent, socket, options, tunnelConfig, cleanupAndPropagate);
    }
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

  if (agentKey && tunnelConfig === null) {
    // Cache new session for reuse. On the proxy-tunnel path `socket` is the
    // connection to the proxy, not the target - establishTunnel attaches
    // these listeners to the tunneled target socket instead, so the proxy's
    // session is never cached under the target's key.
    socket.on("session", onSocketSession.bind(this, agentKey));

    // Evict session on error
    socket.once("close", onSocketClose.bind(this, agentKey));
  }

  return socket;
}

function onSocketSession(agentKey, session) {
  this._cacheSession(agentKey, session);
}

function onSocketClose(agentKey, err) {
  if (err) this._evictSession(agentKey);
}

function Agent(options) {
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

/**
 * Gets a unique name for a set of options.
 */
Agent.prototype.getName = function getName(options = kEmptyObject) {
  let name = http.Agent.prototype.getName.$call(this, options);

  const {
    ca,
    cert,
    clientCertEngine,
    ciphers,
    key,
    pfx,
    rejectUnauthorized,
    servername,
    host,
    minVersion,
    maxVersion,
    secureProtocol,
    crl,
    honorCipherOrder,
    ecdhCurve,
    dhparam,
    secureOptions,
    sessionIdContext,
    sigalgs,
    privateKeyIdentifier,
    privateKeyEngine,
  } = options;

  name += ":";
  if (ca) name += ca;

  name += ":";
  if (cert) name += cert;

  name += ":";
  if (clientCertEngine) name += clientCertEngine;

  name += ":";
  if (ciphers) name += ciphers;

  name += ":";
  if (key) name += key;

  name += ":";
  if (pfx) name += pfx;

  name += ":";
  if (rejectUnauthorized !== undefined) name += rejectUnauthorized;

  name += ":";
  if (servername && servername !== host) name += servername;

  name += ":";
  if (minVersion) name += minVersion;

  name += ":";
  if (maxVersion) name += maxVersion;

  name += ":";
  if (secureProtocol) name += secureProtocol;

  name += ":";
  if (crl) name += crl;

  name += ":";
  if (honorCipherOrder !== undefined) name += honorCipherOrder;

  name += ":";
  if (ecdhCurve) name += ecdhCurve;

  name += ":";
  if (dhparam) name += dhparam;

  name += ":";
  if (secureOptions !== undefined) name += secureOptions;

  name += ":";
  if (sessionIdContext) name += sessionIdContext;

  name += ":";
  if (sigalgs) name += JSONStringify(sigalgs);

  name += ":";
  if (privateKeyIdentifier) name += privateKeyIdentifier;

  name += ":";
  if (privateKeyEngine) name += privateKeyEngine;

  return name;
};

Agent.prototype._getSession = function _getSession(key) {
  return this._sessionCache.map[key];
};

Agent.prototype._cacheSession = function _cacheSession(key, session) {
  // Cache is disabled
  if (this.maxCachedSessions === 0) return;

  // Fast case - update existing entry
  const sessionMap = this._sessionCache.map;
  if (sessionMap[key]) {
    sessionMap[key] = session;
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

const { shouldUseEnvProxy } = require("node:_http_agent");

// Like Node's https.Server constructor: default ALPNProtocols to ['http/1.1']
// when neither ALPNProtocols nor ALPNCallback was given, and store the
// normalized protocol list / callback on the server instance the way
// tls.Server does (test-https-argument-of-creating.js).
// https://github.com/nodejs/node/blob/v26.3.0/lib/https.js#L82-L97
function createServer(options, requestListener) {
  if (typeof options === "function") {
    requestListener = options;
    options = {};
  } else if (options == null) {
    options = {};
  } else {
    validateObject(options, "options");
    options = { ...options };
  }
  if (!options.ALPNProtocols && !options.ALPNCallback) {
    // http/1.0 is not defined as a Protocol ID in the IANA registry, so
    // ALPN requests are always answered with http/1.1.
    options.ALPNProtocols = ["http/1.1"];
  }
  const server = http.createServer(options, requestListener);
  const optionsALPNProtocols = options.ALPNProtocols;
  if (optionsALPNProtocols) {
    tls.convertALPNProtocols(optionsALPNProtocols, server);
  }
  server.ALPNCallback = options.ALPNCallback;
  return server;
}

var https = {
  Agent,
  globalAgent: new Agent({
    keepAlive: true,
    scheduling: "lifo",
    timeout: 5000,
    proxyEnv: shouldUseEnvProxy() ? process.env : undefined,
  }),
  Server: http.Server,
  createServer,
  get,
  request,
};
export default https;
