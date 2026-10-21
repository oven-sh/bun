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
        length: 1,
      },
      upgrade: {
        fn: "doUpgrade",
        length: 1,
      },
      publish: {
        fn: "doPublish",
        length: 3,
      },
      subscriberCount: {
        fn: "doSubscriberCount",
        length: 1,
      },
      reload: {
        fn: "doReload",
        length: 2,
      },
      "@@dispose": {
        fn: "dispose",
        length: 0,
      },
      closeIdleConnections: {
        fn: "closeIdleConnections",
        length: 0,
      },
      stop: {
        fn: "doStop",
        length: 1,
      },
      requestIP: {
        fn: "doRequestIP",
        length: 1,
      },
      timeout: {
        fn: "doTimeout",
        length: 2,
      },
      port: {
        getter: "getPort",
      },
      id: {
        getter: "getId",
        cache: true,
      },
      pendingRequests: {
        getter: "getPendingRequests",
      },
      pendingWebSockets: {
        getter: "getPendingWebSockets",
      },
      ref: {
        fn: "doRef",
      },
      unref: {
        fn: "doUnref",
      },
      hostname: {
        getter: "getHostname",
        cache: true,
      },
      address: {
        getter: "getAddress",
        cache: true,
      },
      url: {
        getter: "getURL",
        cache: true,
      },
      protocol: {
        getter: "getProtocol",
      },
      development: {
        getter: "getDevelopment",
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
        length: 2,
      },
      sendText: {
        fn: "sendText",
        length: 2,
      },
      sendBinary: {
        fn: "sendBinary",
        length: 2,
      },
      publishText: {
        fn: "publishText",
        length: 2,
      },
      publishBinary: {
        fn: "publishBinary",
        length: 2,
      },
      ping: {
        fn: "ping",
        length: 1,
      },
      pong: {
        fn: "pong",
        length: 1,
      },
      close: {
        fn: "close",
        length: 3,
        passThis: true,
      },
      terminate: {
        fn: "terminate",
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
        length: 0,
      },
      pause: {
        fn: "pause",
        length: 0,
      },
      resume: {
        fn: "resume",
        length: 0,
      },
      isPaused: {
        getter: "getIsPaused",
      },
      binaryType: {
        getter: "getBinaryType",
        setter: "setBinaryType",
      },
      publish: {
        fn: "publish",
        length: 3,
      },
      data: {
        getter: "getData",
        cache: true,
        setter: "setData",
      },
      readyState: {
        getter: "getReadyState",
      },
      subscribe: {
        fn: "subscribe",
        length: 1,
      },
      unsubscribe: {
        fn: "unsubscribe",
        length: 1,
      },
      isSubscribed: {
        fn: "isSubscribed",
        length: 1,
      },
      subscriptions: {
        getter: "getSubscriptions",
      },
      remoteAddress: {
        getter: "getRemoteAddress",
        cache: true,
      },
    },
    finalize: true,
    construct: true,
    klass: {},
    values: ["server"],
  }),
];
