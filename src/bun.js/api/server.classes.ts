import { define } from "../scripts/class-definitions";

function generate(name) {
  return define({
    name,
    proto: {
      fetch: {
        fn: "fetch",
        length: 1,
      },
    },
    values: ["callback"],
    klass: {},
    finalize: true,
    construct: true,
  });
}
export default [
  // generate(`HTTPServer`),
  // generate(`DebugModeHTTPServer`),
  // generate(`HTTPSServer`),
  // generate(`DebugModeHTTPSServer`),

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

      close: {
        fn: "close",
        length: 1,
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

      // topics: {
      //   getter: "getTopics",
      // },

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
