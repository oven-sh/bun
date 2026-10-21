import * as b from "../../codegen/bindgen-lib.ts";

export const ServerProtocol = b.enumeration(["http", "https"]);

/** What `Bun.serve` returns. There is one class for each `NewServer<SSL, DEBUG>`. */
function server(name: string) {
  return b.class({
    rustPath: `crate::server::${name}`,
    refCounted: true,
    finalize: true,
    memoryCost: true,
    configurable: false,
    /** The handlers, which the struct also has for the request path to read, and the C++ list of route handlers. */
    internalFields: [
      "routeList",
      "onRequest",
      "onError",
      "onNodeHTTPRequest",
      "onClientError",
      "onConnection",
      "wsOnOpen",
      "wsOnMessage",
      "wsOnClose",
      "wsOnDrain",
      "wsOnError",
      "wsOnPing",
      "wsOnPong",
      "wsPackageHandlers",
    ],
    proto: {
      address: { getter: b.any, cache: true, capability: "js", throws: true },
      closeIdleConnections: { returns: b.usize, capability: "js" },
      development: { getter: b.bool },
      fetch: {
        args: { input: b.any, init: b.any },
        returns: b.any,
        capability: "js",
        throws: true,
        length: 1,
        rustName: "on_fetch",
      },
      hostname: { getter: b.any, cache: true, capability: "js", throws: true },
      id: { getter: b.string.utf8, cache: true },
      pendingRequests: { getter: b.i32 },
      pendingWebSockets: { getter: b.i32 },
      port: { getter: b.u16.optional },
      protocol: { getter: ServerProtocol },
      publish: {
        args: { topic: b.any, message: b.any, compress: b.any },
        returns: b.any,
        capability: "js",
        throws: true,
        rustName: "do_publish",
      },
      ref: { returns: b.any, passThis: true, rustName: "do_ref" },
      reload: {
        args: { options: b.any },
        returns: b.any,
        capability: "js",
        throws: true,
        length: 2,
        rustName: "on_reload",
      },
      requestIP: {
        args: { request: b.any },
        returns: b.any,
        capability: "js",
        throws: true,
        rustName: "do_request_ip",
      },
      stop: {
        args: { closeActiveConnections: b.any },
        returns: b.any,
        capability: "js",
        rustName: "stop_from_js",
      },
      subscriberCount: {
        args: { topic: b.any },
        returns: b.u32,
        capability: "js",
        throws: true,
        rustName: "do_subscriber_count",
      },
      timeout: { args: { request: b.any, seconds: b.any }, returns: b.any, capability: "heap", throws: true },
      unref: { returns: b.any, passThis: true, rustName: "do_unref" },
      upgrade: {
        args: { request: b.any, options: b.any },
        returns: b.bool,
        capability: "js",
        throws: true,
        length: 1,
        rustName: "on_upgrade",
      },
      url: { getter: b.any, cache: true, capability: "js", throws: true },
      "@@dispose": { capability: "js", rustName: "dispose_from_js" },
    },
  });
}

export const HTTPServer = server("HTTPServer");
export const DebugHTTPServer = server("DebugHTTPServer");
export const HTTPSServer = server("HTTPSServer");
export const DebugHTTPSServer = server("DebugHTTPSServer");

/** What a binary message, ping or pong is given to its handler as. */
export const WebSocketBinaryType = b.enumeration([
  ["nodebuffer", "Buffer", "buffer"],
  ["arraybuffer", "ArrayBuffer"],
  ["uint8array", "Uint8Array"],
  "blob",
]);

/** A closed socket ignores the call whatever the arguments are, so the body converts them. */
const send = {
  args: { message: b.any, compress: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
} as const;
const control = { args: { data: b.any }, returns: b.any, capability: "js", throws: true } as const;
const publish = {
  args: { topic: b.any, message: b.any, compress: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
} as const;
const topic = { args: { topic: b.any }, returns: b.bool, capability: "js", throws: true } as const;

/** The first argument of the `websocket` handlers of `Bun.serve`. */
export const ServerWebSocket = b.class({
  rustPath: "crate::server::ServerWebSocket",
  memoryCost: true,
  configurable: false,
  construct: { capability: "heap", throws: true },
  /** `server` keeps the handlers the struct points at alive. */
  internalFields: ["data", "server"],
  proto: {
    binaryType: { getter: WebSocketBinaryType, setter: true },
    close: { args: { code: b.any, reason: b.any }, capability: "js", throws: true, length: 3 },
    cork: {
      args: { callback: b.callable },
      expected: { callback: ["function"] },
      returns: b.any,
      capability: "js",
      throws: true,
      passThis: true,
    },
    data: { internalField: "data", setter: true },
    getBufferedAmount: { returns: b.usize },
    isPaused: { getter: b.bool },
    isSubscribed: topic,
    pause: {},
    ping: control,
    pong: control,
    publish,
    publishBinary: { ...publish, length: 2 },
    publishText: { ...publish, length: 2 },
    readyState: { getter: b.i32 },
    remoteAddress: { getter: b.any, cache: true, capability: "js", throws: true },
    resume: {},
    send,
    sendBinary: send,
    sendText: send,
    subscribe: topic,
    subscriptions: { getter: b.any, capability: "js", throws: true },
    terminate: { capability: "js" },
    unsubscribe: topic,
  },
});
