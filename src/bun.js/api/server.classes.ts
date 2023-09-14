import { define } from "../scripts/class-definitions";

function generate(name) {
  return define({
    name,
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
      reload: {
        fn: "doReload",
        length: 2,
      },
      stop: {
        fn: "doStop",
        length: 1,
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
      hostname: {
        getter: "getHostname",
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
    proto: {
      send: {
        fn: "send",
        length: 2,
      },
      sendText: {
        fn: "sendText",
        length: 2,
        DOMJIT: {
          returns: "int",
          args: ["JSString", "bool"],
        },
      },
      sendBinary: {
        fn: "sendBinary",
        length: 2,
        DOMJIT: {
          returns: "int",
          args: ["JSUint8Array", "bool"],
        },
      },
      publishText: {
        fn: "publishText",
        length: 2,
        DOMJIT: {
          returns: "int",
          args: ["JSString", "JSString"],
        },
      },
      publishBinary: {
        fn: "publishBinary",
        length: 2,
        DOMJIT: {
          returns: "int",
          args: ["JSString", "JSUint8Array"],
        },
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
      },
      terminate: {
        fn: "terminate",
        length: 0,
      },
      cork: {
        fn: "cork",
        length: 1,
      },
      getBufferedAmount: {
        fn: "getBufferedAmount",
        length: 0,
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
      remoteAddress: {
        getter: "getRemoteAddress",
        cache: true,
      },
    },
    finalize: true,
    construct: true,
    klass: {},
  }),
];
