import * as b from "../../codegen/bindgen-lib.ts";
import { BuildArtifact } from "../api/JSBundler.bind.ts";
import { Blob } from "../webcore/Blob.bind.ts";
import { Headers, Request } from "../webcore/response.bind.ts";

export const ServerProtocol = b.enumeration(["http", "https"]);

export const UpgradeHeaders = b.union({ none: b.null, headers: Headers, init: b.object });
/** `server.upgrade` reads them only for a valid handshake. */
export const UpgradeInit = b.dictionary(
  {
    data: b.opaque.optional,
    headers: { type: UpgradeHeaders, expected: "upgrade options.headers must be a Headers or an object" },
  },
  { deferred: true },
);

/** Told apart without running JavaScript. `other`, where a method takes it, is sent as its `ToString`. */
export const WebSocketMessage = b.union({
  missing: b.undefined,
  none: b.null,
  buffer: b.bufferSource.allowShared,
  blob: Blob,
  buildArtifact: BuildArtifact,
  string: b.stringLike,
  other: b.opaque,
});

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
      address: { getter: b.opaque.returning("string", "object", "null"), cache: true, capability: "js", throws: true },
      closeIdleConnections: { returns: b.usize, capability: "js" },
      development: { getter: b.bool, pure: true },
      fetch: {
        args: { input: b.opaque, init: b.opaque },
        returns: b.promise,
        capability: "js",
        throws: true,
        length: 1,
      },
      hostname: { getter: b.opaque.returning("string", "undefined"), cache: true, capability: "js", throws: true },
      id: { getter: b.string.utf8, cache: true },
      pendingRequests: { getter: b.i32, pure: true },
      pendingWebSockets: { getter: b.i32, pure: true },
      port: { getter: b.u16.optional },
      protocol: { getter: ServerProtocol },
      /** `publish(topic)` throws. `publish(topic, undefined)` sends the text "undefined". */
      publish: {
        args: {
          topic: b.string.loose.utf8.nullable,
          data: WebSocketMessage.ifPassed,
          compress: b.bool.loose.default(true),
        },
        returns: b.opaque.returning("number"),
        capability: "js",
        throws: true,
        length: 3,
      },
      ref: { returns: b.self, passThis: true, rustName: "do_ref" },
      reload: {
        args: { options: b.opaque },
        returns: b.self,
        capability: "js",
        throws: true,
        passThis: true,
        length: 2,
      },
      requestIP: {
        args: { request: Request },
        returns: b.opaque.returning("object", "null"),
        capability: "js",
        throws: true,
      },
      stop: {
        args: { closeActiveConnections: b.bool.otherAsNull },
        returns: b.promise,
        capability: "js",
        length: 1,
        rustName: "do_stop",
      },
      subscriberCount: {
        args: { topic: b.bytes({ from: ["string"], otherwise: "toString", refuse: ["undefined", "null"] }) },
        returns: b.u32,
      },
      timeout: {
        args: { request: b.opaque, seconds: b.opaque },
        returns: b.opaque.returning("undefined", "null"),
        capability: "heap",
        throws: true,
      },
      unref: { returns: b.self, passThis: true, rustName: "do_unref" },
      upgrade: {
        args: { request: b.opaque, options: UpgradeInit.nullable.deferred },
        expected: { options: "upgrade options must be an object" },
        returns: b.bool,
        capability: "js",
        throws: true,
        length: 1,
      },
      url: { getter: b.object.returning("URL"), cache: true, capability: "js", throws: true },
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

/** A closed socket ignores the call whatever the arguments are, so no argument type refuses a value or runs JavaScript. */
const send = {
  args: { data: WebSocketMessage, compress: b.opaque },
  returns: b.opaque.returning("number"),
  capability: "js",
  throws: true,
} as const;
const control = {
  args: { data: WebSocketMessage },
  returns: b.opaque.returning("number"),
  capability: "js",
  throws: true,
} as const;
const publish = {
  args: { topic: b.opaque, data: WebSocketMessage, compress: b.opaque },
  returns: b.opaque.returning("number"),
  capability: "js",
  throws: true,
} as const;
const topic = { args: { topic: b.opaque }, returns: b.bool, capability: "js", throws: true } as const;

/** The first argument of the `websocket` handlers of `Bun.serve`. */
export const ServerWebSocket = b.class({
  rustPath: "crate::server::ServerWebSocket",
  memoryCost: true,
  construct: { capability: "heap", throws: true },
  /** `server` keeps the handlers the struct points at alive. */
  internalFields: ["data", "server"],
  proto: {
    binaryType: { getter: BinaryType, setter: true },
    close: {
      args: { code: b.opaque, reason: b.string.loose.utf8.owned.optional.deferred },
      capability: "js",
      throws: true,
      length: 3,
    },
    cork: {
      args: { callback: b.callable },
      expected: { callback: ["function"] },
      returns: b.opaque,
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
    remoteAddress: { getter: b.opaque.returning("string", "undefined"), cache: true, capability: "js", throws: true },
    resume: {},
    send,
    sendBinary: send,
    sendText: send,
    subscribe: topic,
    subscriptions: { getter: b.jsArray, capability: "js", throws: true },
    terminate: { capability: "js" },
    unsubscribe: topic,
  },
});
