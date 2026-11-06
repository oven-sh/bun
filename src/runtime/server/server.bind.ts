import * as b from "../../codegen/bindgen-lib.ts";

export const ServerProtocol = b.enumeration(["http", "https"]);

/** What `Bun.serve` returns. There is one class for each `NewServer<SSL, DEBUG>`. */
function server(name: string) {
  return b.class({
    rustPath: `crate::server::${name}`,
    refCounted: true,
    finalize: true,
    memoryCost: true,
    /** GC roots for the handlers (the struct keeps raw copies for the request path) and for the C++ route list. */
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
      address: { getter: b.any.returning("string", "object", "null"), cache: true, capability: "js", throws: true },
      closeIdleConnections: { returns: b.usize, capability: "js" },
      development: { getter: b.bool, pure: true },
      fetch: {
        args: { input: b.any, init: b.any },
        returns: b.any.returning("Promise"),
        capability: "js",
        throws: true,
        length: 1,
      },
      hostname: { getter: b.any.returning("string", "undefined"), cache: true, capability: "js", throws: true },
      id: { getter: b.string.utf8, cache: true },
      pendingRequests: { getter: b.i32, pure: true },
      pendingWebSockets: { getter: b.i32, pure: true },
      port: { getter: b.u16.optional },
      protocol: { getter: ServerProtocol },
      /** `publish(topic)` throws. `publish(topic, undefined)` sends the text "undefined". */
      publish: {
        args: { topic: b.any, rest: b.any.variadic },
        returns: b.any.returning("number"),
        capability: "js",
        throws: true,
        length: 3,
      },
      ref: { returns: b.self, passThis: true, rustName: "do_ref" },
      reload: {
        args: { options: b.any },
        returns: b.self,
        capability: "js",
        throws: true,
        passThis: true,
        length: 2,
      },
      requestIP: {
        args: { request: b.any },
        returns: b.any.returning("object", "null"),
        capability: "js",
        throws: true,
      },
      stop: {
        args: { closeActiveConnections: b.any },
        returns: b.any.returning("Promise"),
        capability: "js",
        rustName: "do_stop",
      },
      subscriberCount: {
        args: { topic: b.any },
        returns: b.u32,
        capability: "js",
        throws: true,
      },
      timeout: {
        args: { request: b.any, seconds: b.any },
        returns: b.any.returning("undefined", "null"),
        capability: "heap",
        throws: true,
      },
      unref: { returns: b.self, passThis: true, rustName: "do_unref" },
      upgrade: {
        args: { request: b.any, options: b.any },
        returns: b.bool,
        capability: "js",
        throws: true,
        length: 1,
      },
      url: { getter: b.any.returning("URL"), cache: true, capability: "js", throws: true },
      "@@dispose": { capability: "js" },
    },
  });
}

export const HTTPServer = server("HTTPServer");
export const DebugHTTPServer = server("DebugHTTPServer");
export const HTTPSServer = server("HTTPSServer");
export const DebugHTTPSServer = server("DebugHTTPSServer");

/** The type binary messages, pings and pongs are delivered as. */
export const BinaryType = b.enumeration([
  ["nodebuffer", "Buffer", "buffer"],
  ["arraybuffer", "ArrayBuffer"],
  ["uint8array", "Uint8Array"],
  "blob",
]);

/** `b.any`: a closed socket must ignore the call before any argument is converted. */
const send = {
  args: { data: b.any, compress: b.any },
  returns: b.any.returning("number"),
  capability: "js",
  throws: true,
} as const;
const control = { args: { data: b.any }, returns: b.any.returning("number"), capability: "js", throws: true } as const;
const publish = {
  args: { topic: b.any, data: b.any, compress: b.any },
  returns: b.any.returning("number"),
  capability: "js",
  throws: true,
} as const;
const topic = { args: { topic: b.any }, returns: b.bool, capability: "js", throws: true } as const;

/** The first argument of the `websocket` handlers of `Bun.serve`. */
export const ServerWebSocket = b.class({
  rustPath: "crate::server::ServerWebSocket",
  memoryCost: true,
  construct: { capability: "heap", throws: true },
  /** `server` keeps the handlers the struct points at alive. */
  internalFields: ["data", "server"],
  proto: {
    binaryType: { getter: BinaryType, setter: true },
    close: { args: { code: b.any, reason: b.any }, capability: "js", throws: true, length: 3 },
    cork: {
      args: { callback: b.callable },
      expected: { callback: ["function"] },
      returns: b.any,
      capability: "js",
      throws: true,
      passThis: true,
    },
    data: { setter: true, internalField: "data" },
    getBufferedAmount: { returns: b.usize },
    isPaused: { getter: b.bool },
    isSubscribed: topic,
    pause: {},
    ping: control,
    pong: control,
    publish,
    publishBinary: { ...publish, length: 2 },
    publishText: { ...publish, length: 2 },
    readyState: { getter: b.i32, pure: true },
    remoteAddress: { getter: b.any.returning("string", "undefined"), cache: true, capability: "js", throws: true },
    resume: {},
    send,
    sendBinary: send,
    sendText: send,
    subscribe: topic,
    subscriptions: { getter: b.any.returning("Array"), capability: "js", throws: true },
    terminate: { capability: "js" },
    unsubscribe: topic,
  },
});
