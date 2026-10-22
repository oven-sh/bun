import { define } from "../../codegen/class-definitions.ts";

function generate(name) {
  return define({
    name,
    // R-2 Phase 3 opt-out: `Server<SSL, DEBUG>` host-fns still take
    // `&mut self`. Remove once the server impl is Cell/JsCell-migrated.
    sharedThis: false,
    memoryCost: true,
    proto: {
      fetch: {
        fn: "doFetch",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 1,
      },
      upgrade: {
        fn: "doUpgrade",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
      publish: {
        fn: "doPublish",
        returns: "number",
        checkedAtRuntime: true,
        length: 3,
      },
      subscriberCount: {
        fn: "doSubscriberCount",
        returns: "number",
        checkedAtRuntime: true,
        length: 1,
      },
      reload: {
        fn: "doReload",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 2,
      },
      "@@dispose": {
        fn: "dispose",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      closeIdleConnections: {
        fn: "closeIdleConnections",
        returns: "number",
        checkedAtRuntime: true,
        length: 0,
      },
      stop: {
        fn: "doStop",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 1,
      },
      requestIP: {
        fn: "doRequestIP",
        returns: "object | null",
        checkedAtRuntime: true,
        length: 1,
      },
      timeout: {
        fn: "doTimeout",
        returns: "undefined | null",
        checkedAtRuntime: true,
        length: 2,
      },
      port: {
        getter: "getPort",
        type: "number | undefined",
      },
      id: {
        getter: "getId",
        type: "string",
        cache: true,
      },
      pendingRequests: {
        getter: "getPendingRequests",
        type: "int32",
        pure: true,
      },
      pendingWebSockets: {
        getter: "getPendingWebSockets",
        type: "int32",
        pure: true,
      },
      ref: {
        fn: "doRef",
        returns: "this",
        checkedAtRuntime: true,
      },
      unref: {
        fn: "doUnref",
        returns: "this",
        checkedAtRuntime: true,
      },
      hostname: {
        getter: "getHostname",
        type: "string | undefined",
        cache: true,
      },
      address: {
        getter: "getAddress",
        type: "string | object | null",
        checkedAtRuntime: true,
        cache: true,
      },
      url: {
        getter: "getURL",
        type: "URL",
        checkedAtRuntime: true,
        cache: true,
      },
      protocol: {
        getter: "getProtocol",
        type: "string",
      },
      development: {
        getter: "getDevelopment",
        type: "boolean",
        pure: true,
      },
    },
    klass: {},
    finalize: true,
    construct: true,
    noConstructor: true,
    values: [
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
  });
}
export default [
  generate(`HTTPServer`),
  generate(`DebugHTTPServer`),
  generate(`HTTPSServer`),
  generate(`DebugHTTPSServer`),

  define({
    name: "NodeHTTPResponse",
    types: [{ path: ["$Node", "NodeHTTPResponse"], isView: false, typeArguments: [] }],
    lockedPrototype: true,
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    JSType: "0b11101110",
    proto: {
      writeHead: {
        fn: "writeHead",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 3,
      },
      writeContinue: {
        fn: "writeContinue",
        returns: "undefined",
        checkedAtRuntime: true,
      },
      writeInformational: {
        fn: "writeInformational",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      write: {
        fn: "write",
        returns: "number",
        checkedAtRuntime: true,
        length: 3,
      },
      end: {
        fn: "end",
        returns: "number | undefined",
        checkedAtRuntime: true,
        length: 2,
      },
      getBytesWritten: {
        fn: "getBytesWritten",
        returns: "number",
        checkedAtRuntime: true,
        length: 0,
      },
      flushHeaders: {
        fn: "flushHeaders",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      cork: {
        fn: "cork",
        length: 1,
      },
      ref: {
        fn: "jsRef",
        returns: "undefined",
        checkedAtRuntime: true,
      },
      unref: {
        fn: "jsUnref",
        returns: "undefined",
        checkedAtRuntime: true,
      },
      abort: {
        fn: "abort",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      pause: {
        fn: "doPause",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 0,
        passThis: true,
      },
      pauseReads: {
        fn: "pauseSocketReads",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      notifyWhenReadParsed: {
        fn: "notifyWhenReadParsed",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 0,
      },
      takeRequestTrailers: {
        fn: "takeRequestTrailers",
        returns: "Array | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      takeRawHeaders: {
        fn: "takeRawHeaders",
        returns: "Array | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      headersObject: {
        fn: "headersObject",
        returns: "object | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      writeHeadAndEnd: {
        fn: "writeHeadAndEnd",
        returns: "number | undefined",
        checkedAtRuntime: true,
        length: 8,
      },
      resume: {
        fn: "doResume",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 0,
      },
      bufferedAmount: {
        getter: "getBufferedAmount",
        type: "number",
        pure: true,
      },
      aborted: {
        getter: "getAborted",
        type: "boolean",
        pure: true,
      },
      flags: {
        getter: "getFlags",
        type: "int32",
        pure: true,
      },
      finished: {
        getter: "getFinished",
        type: "boolean",
        pure: true,
      },
      hasBody: {
        getter: "getHasBody",
        type: "int32",
        pure: true,
      },
      ondata: {
        getter: "getOnData",
        setter: "setOnData",
        this: true,
      },
      onabort: {
        getter: "getOnAbort",
        setter: "setOnAbort",
        this: true,
      },
      upgraded: {
        getter: "getUpgraded",
        type: "boolean",
        pure: true,
      },
      onwritable: {
        getter: "getOnWritable",
        setter: "setOnWritable",
        this: true,
      },
    },
    klass: {},
    refCounted: true,
    noConstructor: true,
    values: ["onAborted", "onWritable", "onData", "pendingWriteBuffer"],
  }),

  define({
    name: "ServerWebSocket",
    JSType: "0b11101110",
    memoryCost: true,
    // R-2: user impls already take `&self` (see ServerWebSocket.rs:29 — flags
    // / packed_websocket_ptr / this_value are `Cell`/`JsCell`). The generated
    // shims were still `this: &mut ServerWebSocket`, which is Stacked-Borrows
    // UB whenever a host-fn re-enters JS (cork/send → on_message). With
    // `sharedThis` the codegen emits `this: &ServerWebSocket` and routes
    // through the `host_fn::*_shared` helpers.
    sharedThis: true,
    proto: {
      send: {
        fn: "send",
        returns: "number",
        checkedAtRuntime: true,
        length: 2,
      },
      sendText: {
        fn: "sendText",
        returns: "number",
        checkedAtRuntime: true,
        length: 2,
      },
      sendBinary: {
        fn: "sendBinary",
        returns: "number",
        checkedAtRuntime: true,
        length: 2,
      },
      publishText: {
        fn: "publishText",
        returns: "number",
        checkedAtRuntime: true,
        length: 2,
      },
      publishBinary: {
        fn: "publishBinary",
        returns: "number",
        checkedAtRuntime: true,
        length: 2,
      },
      ping: {
        fn: "ping",
        returns: "number",
        checkedAtRuntime: true,
        length: 1,
      },
      pong: {
        fn: "pong",
        returns: "number",
        checkedAtRuntime: true,
        length: 1,
      },
      close: {
        fn: "close",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 3,
        passThis: true,
      },
      terminate: {
        fn: "terminate",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
        passThis: true,
      },
      cork: {
        fn: "cork",
        length: 1,
        passThis: true,
      },
      getBufferedAmount: {
        fn: "getBufferedAmount",
        returns: "number",
        checkedAtRuntime: true,
        length: 0,
      },
      pause: {
        fn: "pause",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      resume: {
        fn: "resume",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      isPaused: {
        getter: "getIsPaused",
        type: "boolean",
      },
      binaryType: {
        getter: "getBinaryType",
        type: "string",
        setter: "setBinaryType",
      },
      publish: {
        fn: "publish",
        returns: "number",
        checkedAtRuntime: true,
        length: 3,
      },
      data: {
        getter: "getData",
        cache: true,
        setter: "setData",
      },
      readyState: {
        getter: "getReadyState",
        type: "int32",
        pure: true,
      },
      subscribe: {
        fn: "subscribe",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
      unsubscribe: {
        fn: "unsubscribe",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
      isSubscribed: {
        fn: "isSubscribed",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
      subscriptions: {
        getter: "getSubscriptions",
        type: "Array",
        checkedAtRuntime: true,
      },
      remoteAddress: {
        getter: "getRemoteAddress",
        type: "string | undefined",
        cache: true,
      },
    },
    finalize: true,
    construct: true,
    klass: {},
    values: ["server"],
  }),

  define({
    name: "HTMLBundle",
    noConstructor: true,
    refCounted: true,
    proto: {
      index: {
        getter: "getIndex",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
    },
    klass: {},
  }),
];
