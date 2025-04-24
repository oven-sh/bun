// This module is based on the Node.js `http` module:
// https://github.com/nodejs/node/blob/main/lib/http.js

// Use require for runtime values and type inference
const { validateInteger } = require("internal/validators");

// Import PUBLIC types from node:http
import type {
  Agent as HttpAgent, // Use alias to avoid collision with const Agent
  AgentOptions as HttpAgentOptions,
  ClientRequest as HttpClientRequest, // Use alias
  RequestOptions as HttpClientRequestArgs,
  IncomingMessage as HttpIncomingMessage, // Use alias
  OutgoingMessage as HttpOutgoingMessage, // Use alias
  Server as HttpServer, // Use alias
  ServerOptions as HttpServerOptions,
  ServerResponse as HttpServerResponse, // Use alias
  RequestListener as HttpRequestListener,
} from "node:http";
import type { EventEmitterAsyncResource } from "node:events"; // Needed for static properties on stream classes
import { URL } from "node:url"; // Needed for request parsing

// Define constructor types based on public types if needed, or use typeof directly
// Add missing static properties expected by node:http types
type HttpAgentConstructor = typeof HttpAgent & typeof EventEmitterAsyncResource;
type HttpServerConstructor = typeof HttpServer & typeof EventEmitterAsyncResource;
type HttpClientRequestConstructor = typeof HttpClientRequest & typeof EventEmitterAsyncResource;
type HttpIncomingMessageConstructor = typeof HttpIncomingMessage & typeof EventEmitterAsyncResource;
type HttpOutgoingMessageConstructor = typeof HttpOutgoingMessage & typeof EventEmitterAsyncResource;
type HttpServerResponseConstructor = typeof HttpServerResponse & typeof EventEmitterAsyncResource;


// Load runtime modules using require with type assertions
const AgentModule = require("node:_http_agent") as any as {
    Agent: HttpAgentConstructor;
    globalAgent: HttpAgent;
    NODE_HTTP_WARNING: string;
};
const ClientRequestModule = require("node:_http_client") as any as {
    ClientRequest: HttpClientRequestConstructor;
};
const HttpCommonModule = require("node:_http_common") as {
    validateHeaderName: (name: string) => void;
    validateHeaderValue: (name: string, value: any) => void;
};
const IncomingMessageModule = require("node:_http_incoming") as any as {
    IncomingMessage: HttpIncomingMessageConstructor;
};
const OutgoingMessageModule = require("node:_http_outgoing") as {
    OutgoingMessage: HttpOutgoingMessageConstructor;
};
const ServerModule = require("node:_http_server") as {
    Server: HttpServerConstructor;
    ServerResponse: HttpServerResponseConstructor;
};
const { METHODS, STATUS_CODES } = require("internal/http") as typeof import("internal/http");

// Assign runtime values
const Agent = AgentModule.Agent;
const globalAgent = AgentModule.globalAgent;
const NODE_HTTP_WARNING = AgentModule.NODE_HTTP_WARNING;

const ClientRequest = ClientRequestModule.ClientRequest;

const validateHeaderName = HttpCommonModule.validateHeaderName;
const validateHeaderValue = HttpCommonModule.validateHeaderValue;

const IncomingMessage = IncomingMessageModule.IncomingMessage;
const OutgoingMessage = OutgoingMessageModule.OutgoingMessage;

const Server = ServerModule.Server;
const ServerResponse = ServerModule.ServerResponse;


const { WebSocket, CloseEvent, MessageEvent } = globalThis;

// Use PUBLIC types in function signatures
function createServer(options?: HttpServerOptions | HttpRequestListener<typeof HttpIncomingMessage, typeof HttpServerResponse>, callback?: HttpRequestListener<typeof HttpIncomingMessage, typeof HttpServerResponse>): HttpServer {
  // The Server constructor handles the overloaded signature internally
  return new Server(options as any, callback as any);
}

/**
 * Makes an HTTP request.
 * Handles the multiple signatures similar to Node.js http.request.
 * @param {string | URL | RequestOptions} input
 * @param {RequestOptions | Function} [options]
 * @param {Function} [cb]
 * @returns {HttpClientRequest}
 */
function request(input: string | URL | HttpClientRequestArgs, options?: HttpClientRequestArgs | ((res: HttpIncomingMessage) => void), cb?: (res: HttpIncomingMessage) => void): HttpClientRequest {
  let reqOptions: HttpClientRequestArgs;
  let callback: ((res: HttpIncomingMessage) => void) | undefined;

  if (typeof input === 'string' || input instanceof URL) {
    const url = input instanceof URL ? input : new URL(input);
    const urlOptions: HttpClientRequestArgs = { // Extract options from URL
        protocol: url.protocol,
        hostname: typeof url.hostname === 'string' && url.hostname.startsWith('[') ?
                    url.hostname.slice(1, -1) : url.hostname, // Handle [::1]
        port: url.port,
        path: url.pathname + url.search,
    };
     if (url.username || url.password) {
        urlOptions.auth = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    }


    if (typeof options === 'function') {
      callback = options;
      reqOptions = urlOptions; // Use only URL options
    } else {
      callback = cb;
      // Merge options, preferring explicit options over URL ones
      reqOptions = { ...urlOptions, ...options };
    }
  } else { // input is RequestOptions
    reqOptions = { ...input }; // Copy options
    if (typeof options === 'function') {
      callback = options; // Second arg is callback
    } else {
      // If options is not a function, the third arg 'cb' must be the callback
      callback = cb;
    }
  }

  // Call constructor with (options, callback) signature
  // Assume ClientRequest constructor handles default agent, port etc. internally
  return new ClientRequest(reqOptions, callback);
}


/**
 * Makes a `GET` HTTP request. This is a wrapper around `request`.
 * @param {string | URL | RequestOptions} input
 * @param {RequestOptions | Function} [options]
 * @param {Function} [cb]
 * @returns {HttpClientRequest}
 */
function get(input: string | URL | HttpClientRequestArgs, options?: HttpClientRequestArgs | ((res: HttpIncomingMessage) => void), cb?: (res: HttpIncomingMessage) => void): HttpClientRequest {
  const req = request(input, options, cb);
  req.end();
  return req;
}

const setMaxHTTPHeaderSize: (value: number) => void = $newZigFunction("node_http_binding.zig", "setMaxHTTPHeaderSize", 1);
const getMaxHTTPHeaderSize: () => number = $newZigFunction("node_http_binding.zig", "getMaxHTTPHeaderSize", 0);

const http_exports = {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse: ServerResponse,
  IncomingMessage: IncomingMessage,
  request,
  get,
  get maxHeaderSize() {
    return getMaxHTTPHeaderSize();
  },
  set maxHeaderSize(value: number) {
    // TODO: Bun currently doesn't validate this input like Node.js does.
    // Node throws ERR_INVALID_ARG_VALUE for non-uint32 or < 8192.
    setMaxHTTPHeaderSize(value);
  },
  validateHeaderName,
  validateHeaderValue,
  setMaxIdleHTTPParsers(max: number) {
    validateInteger(max, "max", 1);
    $debug(`${NODE_HTTP_WARNING}\n`, "setMaxIdleHTTPParsers() is a no-op");
  },
  globalAgent,
  ClientRequest: ClientRequest,
  OutgoingMessage: OutgoingMessage,
  WebSocket,
  CloseEvent,
  MessageEvent,
};

export default http_exports;

// Re-export necessary types using the PUBLIC types and original names
export type {
  HttpAgent as Agent,
  HttpAgentOptions as AgentOptions,
  HttpAgentConstructor as AgentConstructor,
  HttpClientRequest as ClientRequest,
  HttpClientRequestArgs as ClientRequestArgs,
  HttpIncomingMessage as IncomingMessage,
  HttpOutgoingMessage as OutgoingMessage,
  HttpServer as Server,
  HttpServerOptions as ServerOptions,
  HttpServerResponse as ServerResponse,
  HttpRequestListener as RequestListener,
};