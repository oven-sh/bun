import type { AgentOptions, Agent as HttpAgent } from "node:http"; // Use public http types
import type {
  ClientRequest as _ClientRequest, // Keep alias for clarity
  RequestListener,
  RequestOptions as _RequestOptions,
  ServerOptions as _ServerOptions,
  Server as _Server, // Use public http Server type
  ServerResponse as _ServerResponse,
  IncomingMessage as _IncomingMessage,
} from "node:http"; // Use public http types
import type * as Tls from "node:tls"; // Use namespace import for tls types

// Use require for runtime dependencies
const http = require("node:http");
const tls: typeof Tls = require("node:tls");
const { urlToHttpOptions } = require("internal/url");
const { Agent: HttpAgentClass } = require("node:_http_agent"); // Import the base Agent class runtime value for inheritance

const ArrayPrototypeShift = Array.prototype.shift;
const ObjectAssign = Object.assign;
const ArrayPrototypeUnshift = Array.prototype.unshift;

// --- Agent Definition ---
// Define the Agent class interface extending the runtime http.Agent's structure
// We need to redeclare properties from HttpAgent that we access/modify
// Also add the createConnection method signature.
// Extend the public HttpAgent type
interface Agent extends HttpAgent {
  // Properties specific to our implementation or accessed internally
  defaultPort: number;
  protocol: string;
  maxCachedSessions?: number; // Add property specific to https.Agent
  options: AgentOptions & { maxCachedSessions?: number }; // Add maxCachedSessions here too for options access

  // Method override signature
  createConnection(
    options: Tls.ConnectionOptions,
    cb?: (err?: Error | null, socket?: Tls.TLSSocket) => void,
  ): Tls.TLSSocket;
}

// Define the constructor interface matching http.Agent but returning our Agent
interface AgentConstructor {
  new (options?: AgentOptions & { maxCachedSessions?: number }): Agent; // Allow maxCachedSessions in options
  prototype: Agent;
}

// Implementation of the Agent constructor function
const Agent: AgentConstructor = function Agent(this: Agent | void, options?: AgentOptions & { maxCachedSessions?: number }) {
  if (!(this instanceof Agent)) {
    // Fix TS2350: Ensure 'new' is used by returning a new instance if called without 'new'.
    // This matches typical JavaScript constructor behavior.
    return new (Agent as any)(options);
  }

  // Call the base constructor using $apply
  // Use HttpAgentClass (runtime value from _http_agent) for the actual inheritance logic
  (HttpAgentClass as any).$apply(this as Agent, [options]);

  // Set HTTPS specific properties
  const agentThis = this as Agent; // Use a typed variable for safety
  agentThis.defaultPort = 443;
  agentThis.protocol = "https:";
  agentThis.maxCachedSessions = agentThis.options.maxCachedSessions;
  if (agentThis.maxCachedSessions === undefined) {
    agentThis.maxCachedSessions = 100;
  }
} as any; // Cast to any initially because $toClass modifies it

// Make Agent behave like a class inheriting from http.Agent
// $toClass correctly sets up the prototype chain and constructor property
$toClass(Agent, "Agent", HttpAgentClass);

// Override createConnection for TLS
Agent.prototype.createConnection = function (
  options: Tls.ConnectionOptions,
  cb?: (err?: Error | null, socket?: Tls.TLSSocket) => void,
): Tls.TLSSocket {
  // Ensure servername is set for SNI
  options.servername = options.servername || options.host;

  // Create TLS connection
  const socket = tls.connect(options);

  // Mimic Node's Agent logic: handle 'secureConnect' and 'error' only once
  // Use a state variable instead of removing listeners to avoid potential issues if called multiple times
  let called = false;
  const onSecureConnect = () => {
    if (!called) {
      called = true;
      if (cb) cb(null, socket);
    }
  };
  const onError = (err: Error) => {
    if (!called) {
      called = true;
      if (cb) cb(err);
    }
  };

  // Use 'once' to ensure listeners are called at most once and automatically removed
  socket.once("secureConnect", onSecureConnect);
  socket.once("error", onError);

  // Return the socket immediately, similar to net.createConnection
  return socket;
};

const globalAgent = new Agent({ keepAlive: true, timeout: 5000 } as AgentOptions);

// --- Module Type Definitions ---
// Server type combines Tls.Server behavior with HttpServer interface
type Server<
  Request extends typeof _IncomingMessage = typeof _IncomingMessage,
  Response extends typeof _ServerResponse = typeof _ServerResponse,
> = Tls.Server & _Server<Request, Response>; // Use public http.Server for interface compatibility

type CreateServerOptions = Tls.TlsOptions & _ServerOptions; // Options can be TLS or basic HTTP server options

// Define CreateServer matching https.createServer signature
type CreateServer = <
  Request extends typeof _IncomingMessage = typeof _IncomingMessage,
  Response extends typeof _ServerResponse = typeof _ServerResponse,
>(
  options: CreateServerOptions | RequestListener<Request, Response>, // Options can be TLS or basic HTTP server options, or just the listener
  requestListener?: RequestListener<Request, Response>, // Optional listener if options is provided
) => Server<Request, Response>; // Returns a TLS server behaving like HTTP server

// Define the overloaded request/get types based on node:http
type RequestFunction = {
  (options: _RequestOptions | string | URL, callback?: (res: _IncomingMessage) => void): _ClientRequest;
  (url: string | URL, options: _RequestOptions, callback?: (res: _IncomingMessage) => void): _ClientRequest;
};
type GetFunction = RequestFunction; // get has the same signature as request

// Define HttpsModule type, explicitly including all expected exports from node:https
// This resolves the TS2322 error by defining the correct shape.
// We only include properties that are part of the public API of node:https
// or are standard re-exports from node:http's public API.
// Use the imported types for WebSocket and WebSocketServer.
// Use the actual runtime types for classes/constructors where needed.
type HttpsModule = {
  // HTTPS specific
  Agent: AgentConstructor;
  globalAgent: Agent;
  createServer: CreateServer;
  request: RequestFunction;
  get: GetFunction;
  Server: typeof Tls.Server; // https.Server is tls.Server

  // Re-exports from node:http public API
  ClientRequest: typeof http.ClientRequest;
  IncomingMessage: typeof http.IncomingMessage;
  METHODS: typeof http.METHODS;
  OutgoingMessage: typeof http.OutgoingMessage;
  STATUS_CODES: typeof http.STATUS_CODES;
  ServerResponse: typeof http.ServerResponse;
  maxHeaderSize: typeof http.maxHeaderSize;
  validateHeaderName: typeof http.validateHeaderName;
  validateHeaderValue: typeof http.validateHeaderValue;

  // Add other *public* http re-exports if needed, but avoid internal/non-existent ones
  // For example, if node:https re-exports these:
  // Agent: typeof http.Agent; // Note: We have our own Agent, but if https re-exports http's one too... unlikely needed.
  // ... other http exports
};

// --- request/get Function Definitions ---
// Define the interface for the options object used in request()
// Use composition instead of extension to avoid TS2430 on _defaultAgent
type RequestOptionsInternal = _RequestOptions & {
  _defaultAgent?: Agent; // Use our https Agent type
};

// Implementation needs to handle both overloads internally
function request(...args: any[]): _ClientRequest {
  let options: RequestOptionsInternal = {};
  let url: string | URL | undefined;
  let callback: ((res: _IncomingMessage) => void) | undefined;

  // Parse arguments based on Node's https.request signature
  if (typeof args[0] === "string" || args[0] instanceof URL) {
    url = ArrayPrototypeShift.$call(args);
    if (args[0] && typeof args[0] !== "function") {
      // This must be the options object
      options = ArrayPrototypeShift.$call(args);
    }
    if (typeof args[0] === "function") {
      // This must be the callback
      callback = ArrayPrototypeShift.$call(args);
    }
  } else if (typeof args[0] === "object" && args[0] !== null) {
    // First argument is options object
    options = ArrayPrototypeShift.$call(args);
    if (typeof args[0] === "function") {
      // This must be the callback
      callback = ArrayPrototypeShift.$call(args);
    }
  } else {
    // Should not happen with valid usage according to Node types, but handle defensively
    throw $ERR_INVALID_ARG_TYPE("url or options", ["string", "URL", "object"], args[0]);
  }

  // If URL was provided, merge its properties into options
  if (url) {
    const urlOptions = urlToHttpOptions(url instanceof URL ? url : new URL(url as string));
    // Use ObjectAssign to merge, giving precedence to explicitly passed options
    options = ObjectAssign.$call(null, {}, urlOptions, options);
  }

  options._defaultAgent = globalAgent; // Assign HTTPS agent

  // Call the underlying http.request. It handles the merged options.
  // Cast options to any because _defaultAgent is internal and not part of public http.RequestOptions
  return http.request(options as any, callback);
}

function get(...args: any[]): _ClientRequest {
  // The request function now correctly handles argument parsing.
  const req = request(...args); // Pass arguments directly
  req.end();
  return req;
}

// --- https Object Definition ---
// Build the https object, spreading *public* http properties and overriding specific ones.
// Cast the final object to HttpsModule to resolve TS2322 signature mismatch.
const https = {
  // Explicitly list public properties from the runtime http object
  // This avoids including internal or non-existent properties like WebSocket
  METHODS: http.METHODS,
  STATUS_CODES: http.STATUS_CODES,
  maxHeaderSize: http.maxHeaderSize,
  validateHeaderName: http.validateHeaderName,
  validateHeaderValue: http.validateHeaderValue,
  IncomingMessage: http.IncomingMessage,
  OutgoingMessage: http.OutgoingMessage,
  ServerResponse: http.ServerResponse,
  ClientRequest: http.ClientRequest,
  // Add other necessary public http exports here if they are missing

  // Override with https specific implementations
  Agent: Agent,
  globalAgent: globalAgent,

  // createServer needs to handle TLS options and return a tls.Server
  // but it should behave like an http.Server regarding the requestListener
  createServer: function createServer<
    Request extends typeof _IncomingMessage = typeof _IncomingMessage,
    Response extends typeof _ServerResponse = typeof _ServerResponse,
  >(
    options: CreateServerOptions | RequestListener<Request, Response>,
    requestListener?: RequestListener<Request, Response>,
  ): Server<Request, Response> {
    let serverOptions: Tls.TlsOptions;
    let listener: RequestListener<Request, Response> | undefined;

    if (typeof options === "function") {
      listener = options as RequestListener<Request, Response>;
      serverOptions = {}; // Default options if only listener is provided
    } else {
      serverOptions = options as Tls.TlsOptions;
      listener = requestListener;
    }

    // https.createServer always creates a TLS server in Node.js
    // Cast listener to any: Node's https server internally adapts the tls 'secureConnection' event
    // to trigger the http request parsing and invoke the 'request' listener.
    // We assume Bun's tls.createServer handles this similarly when a requestListener is passed.
    const server = tls.createServer(serverOptions, listener as any) as Server<Request, Response>;

    // Explicitly copy http.Server prototype methods if tls.Server doesn't inherit them directly
    // This ensures methods like listen, close, etc., behave as expected for an http-like server.
    // Note: In standard Node.js, tls.Server *does* inherit from net.Server, which http.Server also uses.
    // This step might be redundant depending on Bun's internal implementation but ensures compatibility.
    // Example (if needed): Object.setPrototypeOf(Object.getPrototypeOf(server), http.Server.prototype);

    return server;
  },

  get: get as HttpsModule["get"], // Cast to the correct overloaded type
  request: request as HttpsModule["request"], // Cast to the correct overloaded type
  // Explicitly set Server to tls.Server constructor (runtime value)
  Server: tls.Server as typeof Tls.Server, // Cast needed as http.Server is different

} as unknown as HttpsModule; // Use unknown first, then assert the final type

export default https;