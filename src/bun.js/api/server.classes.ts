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
      close: {
        fn: "close",
        length: 1,
      },
      getBufferedAmount: {
        fn: "getBufferedAmount",
        length: 0,
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
