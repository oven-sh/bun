import * as b from "../../codegen/bindgen-lib.ts";
import { FrameworkRouterStyle } from "../api/filesystem_router.bind.ts";
import { BuildArtifact } from "../api/JSBundler.bind.ts";
import { Blob } from "../webcore/Blob.bind.ts";
import { Headers, HeadersInit, Request } from "../webcore/response.bind.ts";
import { NodeHTTPResponse } from "./NodeHTTPResponse.bind.ts";

export const ServerProtocol = b.enumeration(["http", "https"]);

/** The alternatives after `request` are what the error of `server.fetch` names. */
export const ServerFetchInput = b.union({
  url: b.string.utf8.owned,
  request: Request,
  undefined: b.undefined,
  null: b.null,
  flag: b.bool,
  number: b.f64,
  symbol: b.symbol,
  bigInt: b.bigInt,
  other: b.ignored,
});
/** Read only if `input` is a URL. */
export const ServerFetchInit = b.dictionary(
  { method: b.string.loose.utf8.owned.optional, headers: HeadersInit, body: b.opaque.optional },
  { deferred: true },
);

export const TimeoutTarget = b.union({
  missing: b.null,
  request: Request,
  response: NodeHTTPResponse,
  other: b.ignored,
});

export const UpgradeHeaders = b.union({ missing: b.null, headers: Headers, init: b.object });
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
  undefined: b.undefined,
  null: b.null,
  buffer: b.bufferSource.allowShared,
  blob: Blob,
  buildArtifact: BuildArtifact,
  string: b.stringLike,
  other: b.opaque,
});
export const WebSocketCompress = b.union({ missing: b.undefined, flag: b.bool, other: b.ignored });

/** `false` is as good as missing. */
export const Stringish = b.union({
  missing: b.null,
  flag: b.bool,
  symbol: b.symbol,
  text: b.string.loose,
});

/** `""` is as good as missing. */
export const DeflateOption = b.union({
  missing: b.null,
  flag: b.bool,
  text: b.string,
  stringObject: b.string.allowStringObject,
  other: b.ignored,
});
export const PerMessageDeflateOptions = b.dictionary(
  { compress: DeflateOption, decompress: DeflateOption },
  { deferred: true },
);
export const PerMessageDeflate = b.union({
  missing: b.undefined,
  null: b.null,
  flag: b.bool,
  options: PerMessageDeflateOptions,
});
/** The `websocket` option of `Bun.serve`. Its handlers are a `WebSocketHandlers`. */
export const WebSocketOptions = b.dictionary(
  {
    perMessageDeflate: {
      type: PerMessageDeflate,
      expected: "websocket expects perMessageDeflate to be a boolean or an object",
    },
    maxPayloadLength: b.opaque.optional,
    idleTimeout: b.opaque.optional,
    backpressureLimit: b.opaque.optional,
    closeOnBackpressureLimit: {
      type: b.bool.nullable,
      expected: "websocket expects closeOnBackpressureLimit to be a boolean",
    },
    sendPings: { type: b.bool.nullable, expected: "websocket expects sendPings to be a boolean" },
    publishToSelf: { type: b.bool.nullable, expected: "websocket expects publishToSelf to be a boolean" },
  },
  { deferred: true },
);
const websocket = { type: WebSocketOptions.emptyStringAsNull, expected: "Expected websocket to be an object" };

export const DevelopmentOptions = b.dictionary(
  {
    hmr: { type: b.bool.optional, expected: ["boolean"] },
    console: { type: b.bool.optional, expected: ["boolean"] },
    chromeDevToolsAutomaticWorkspaceFolders: { type: b.bool.optional, expected: ["boolean"] },
  },
  { allowArray: true, reportedAs: "development" },
);
export const ServerDevelopment = b.union({ missing: b.undefined, options: DevelopmentOptions, flag: b.bool.loose });
export const ServerId = b.union({ missing: b.undefined, null: b.null, id: b.string.loose.utf8.owned });

// `Bake.Options` of bake.d.ts. `src/tsconfig.json` excludes `runtime/bake`, so this file cannot import a schema from there.

const text = { type: b.string.allowStringObject.utf8.owned.nullable, expected: ["string"] };
const flag = b.bool.loose.optional;

export const BakeSourceMap = b.enumeration(["none", "inline", "external", "linked"]);
export const BakeMinifyParts = b.dictionary(
  { whitespace: flag, syntax: flag, identifiers: flag },
  { allowArray: true, reportedAs: "minify" },
);
export const BakeMinify = b.union({ all: b.bool, parts: BakeMinifyParts, other: b.ignored });
export const BuildConfigSubsetOptions = b.dictionary(
  { sourcemap: BakeSourceMap.nullable, minify: BakeMinify.nullable },
  { allowArray: true, reportedAs: "" },
);
export const BakeBundlerOptions = b.dictionary(
  {
    server: BuildConfigSubsetOptions.otherAsNull,
    client: BuildConfigSubsetOptions.otherAsNull,
    ssr: BuildConfigSubsetOptions.otherAsNull,
  },
  { allowArray: true, reportedAs: "bundlerOptions" },
);

/** An element of `plugins`. */
export const BakePlugin = b.dictionary(
  { name: text, setup: { type: b.callable.nullable, expected: "setup must be a function" } },
  { deferred: true, reportedAs: "plugins[n]" },
);
/**
 * Walked by `length` and index, so any object will do. No element of a string, a symbol or a BigInt is an object.
 * `other` has no elements.
 */
export const BakePluginList = b.union({
  text: b.string,
  symbol: b.symbol,
  bigInt: b.bigInt,
  list: b.object,
  other: b.ignored,
});

export const ReactFastRefreshOptions = b.dictionary(
  { importSource: b.string.loose.utf8.owned.optional },
  { allowArray: true },
);
export const ReactFastRefreshValue = b.union({ missing: b.null, enabled: b.bool, options: ReactFastRefreshOptions });
export const ServerComponentsOptions = b.dictionary(
  {
    separateSSRGraph: {
      type: b.bool.nullable,
      expected: "'framework.serverComponents.separateSSRGraph' must be a boolean",
    },
    serverRuntimeImportSource: text,
    serverRegisterClientReferenceExport: text,
  },
  { deferred: true, reportedAs: "framework.serverComponents" },
);
export const ServerComponentsValue = b.union({
  missing: b.null,
  flag: b.bool,
  options: ServerComponentsOptions,
  other: b.ignored,
});
/** An element of `builtInModules`. `code` is read only without `path`. */
export const BuiltInModuleOptions = b.dictionary(
  { import: text, path: text, code: text },
  { deferred: true, reportedAs: "builtInModules[n]" },
);
export const ClientPagesOptions = b.dictionary({ serverExports: b.jsArray.otherAsNull }, { allowArray: true });
export const ClientPagesValue = b.union({
  missing: b.undefined,
  enabled: b.bool,
  options: ClientPagesOptions,
  other: b.ignored,
});
/** The only `text` is `"*"`. */
export const RouterExtensions = b.union({
  text: b.string.allowStringObject.utf8.owned,
  list: b.jsArray,
  other: b.ignored,
});
/** An element of `fileSystemRouterTypes`. */
export const FileSystemRouterTypeOptions = b.dictionary(
  {
    root: text,
    serverEntryPoint: text,
    clientEntryPoint: text,
    prefix: text,
    ignoreUnderscores: { type: b.bool.default(false), expected: ["boolean"] },
    layouts: { type: b.bool.default(false), expected: ["boolean"] },
    clientPages: ClientPagesValue,
    style: FrameworkRouterStyle.optional,
    extensions: RouterExtensions.optional,
    ignoreDirs: { type: b.jsArray.optional, expected: "'ignoreDirs' must be an array of strings" },
  },
  { deferred: true, reportedAs: "fileSystemRouterTypes[n]" },
);
export const FrameworkOptions = b.dictionary(
  {
    /** Replaced by the members of the same names of a `FileSystemRouterTypeOptions`. */
    serverEntryPoint: b.opaque.optional,
    clientEntryPoint: b.opaque.optional,
    reactFastRefresh: {
      type: ReactFastRefreshValue,
      expected: "'framework.reactFastRefresh' must be an object or 'true'",
    },
    serverComponents: ServerComponentsValue,
    builtInModules: { type: b.jsArray.nullable, expected: "builtInModules must be an array" },
    fileSystemRouterTypes: { type: b.jsArray.nullable, expected: "fileSystemRouterTypes must be an array" },
    plugins: BakePluginList.nullable,
  },
  { deferred: true, reportedAs: "framework" },
);
/** A `String` object that is not the name of a built-in framework is read as a `FrameworkOptions`. */
export const FrameworkValue = b.union(
  { name: b.string, stringObject: b.stringObject, options: FrameworkOptions, other: b.ignored },
  { fromJS: true },
);
export const frameworkName = b.conversion(b.string.loose);
export const BakeOptions = b.dictionary(
  {
    bundlerOptions: BakeBundlerOptions.otherAsNull,
    framework: FrameworkValue.optional,
    root: text,
    plugins: BakePluginList.optional,
  },
  { deferred: true, reportedAs: "app" },
);
/** `name` is that of a built-in framework. */
export const BakeApp = b.union({ name: b.string, options: BakeOptions, other: b.ignored }, { fromJS: true });

/** The options of `Bun.serve` and `server.reload`. Without `tls` they are read as a `TLSOptions` too. */
export const ServeOptions = b.dictionary(
  {
    development: ServerDevelopment,
    routes: b.opaque.optional,
    static: { type: b.opaque.optional, rustName: "static_routes" },
    idleTimeout: b.opaque.optional,
    webSocket: websocket,
    websocket,
    port: b.f64.loose.emptyStringAsNull,
    baseURI: b.string.loose.utf8.owned.emptyStringAsNull,
    hostname: Stringish,
    host: Stringish,
    unix: Stringish,
    id: ServerId,
    app: BakeApp.emptyStringAsNull,
    reusePort: b.bool.loose.optional,
    ipv6Only: b.bool.loose.optional,
    http3: b.bool.loose.optional,
    http2: b.bool.loose.optional,
    http1: b.bool.loose.optional,
    maxRequestBodySize: b.f64.otherAsNull,
    error: { type: b.callable.emptyStringAsNull, expected: "Expected error to be a function" },
    onNodeHTTPRequest: {
      type: b.callable.emptyStringAsNull,
      expected: "Expected onNodeHTTPRequest to be a function",
    },
    fetch: { type: b.callable.emptyStringAsNull, expected: "Expected fetch() to be a function" },
    tls: b.opaque.emptyStringAsNull,
  },
  { deferred: true },
);

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
        args: { input: ServerFetchInput, init: ServerFetchInit.otherAsNull },
        returns: b.promise,
        capability: "js",
        throws: true,
        length: 1,
      },
      hostname: { getter: b.string.local.optional, cache: true, capability: "js", throws: true },
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
        args: { options: ServeOptions.otherAsNull },
        returns: b.self,
        capability: "js",
        throws: true,
        passThis: true,
        length: 2,
      },
      requestIP: {
        args: { request: Request },
        returns: b.object.nullable,
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
        args: { request: TimeoutTarget, seconds: b.jsNumber.otherAsNull },
        returns: b.opaque.returning("undefined", "null"),
        capability: "heap",
        throws: true,
        length: 2,
      },
      unref: { returns: b.self, passThis: true, rustName: "do_unref" },
      upgrade: {
        args: { request: b.object.otherAsNull, options: UpgradeInit.nullable.deferred },
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
  args: { data: WebSocketMessage, compress: WebSocketCompress },
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
  args: { topic: b.opaque, data: WebSocketMessage, compress: WebSocketCompress },
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
      args: { code: b.jsNumber.optional.deferred, reason: b.string.loose.utf8.owned.optional.deferred },
      expected: { code: "close requires a numeric code or undefined" },
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
    remoteAddress: { getter: b.string.local.optional, cache: true, capability: "heap", throws: true },
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
