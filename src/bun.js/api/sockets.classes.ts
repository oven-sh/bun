import { define } from "../scripts/class-definitions";

function generate(ssl) {
  return define({
    name: ssl ? "TCPSocket" : "TLSSocket",
    JSType: "0b11101110",
    hasPendingActivity: true,
    noConstructor: true,
    configurable: false,
    proto: {
      getAuthorizationError: {
        fn: "getAuthorizationError",
        length: 0,
      },
      authorized: {
        getter: "getAuthorized",
      },
      alpnProtocol: {
        getter: "getALPNProtocol",
      },
      write: {
        fn: "write",
        length: 3,
      },
      upgradeTLS: {
        fn: "upgradeTLS",
        length: 1,
      },
      end: {
        fn: "end",
        length: 3,
      },

      //   },
      listener: {
        getter: "getListener",
      },

      timeout: {
        fn: "timeout",
        length: 1,
      },

      flush: {
        fn: "flush",
        length: 0,
      },

      shutdown: {
        fn: "shutdown",
        length: 1,
      },

      ref: {
        fn: "ref",
        length: 0,
      },
      unref: {
        fn: "unref",
        length: 0,
      },

      localPort: {
        getter: "getLocalPort",
      },
      //   cork: {
      //     fn: "cork",
      //     length: 1,
      //   },
      data: {
        getter: "getData",
        cache: true,
        setter: "setData",
      },
      readyState: {
        getter: "getReadyState",
      },

      // topics: {
      //   getter: "getTopics",
      // },

      remoteAddress: {
        getter: "getRemoteAddress",
        cache: true,
      },

      reload: {
        fn: "reload",
        length: 1,
      },

      setServername: {
        fn: "setServername",
        length: 1,
      },
    },
    finalize: true,
    construct: true,
    klass: {},
  });
}
export default [
  generate(true),
  generate(false),
  define({
    name: "Listener",
    noConstructor: true,
    JSType: "0b11101110",
    proto: {
      stop: {
        fn: "stop",
        length: 1,
      },

      ref: {
        fn: "ref",
        length: 0,
      },
      unref: {
        fn: "unref",
        length: 0,
      },

      port: {
        getter: "getPort",
      },

      unix: {
        getter: "getUnix",
        cache: true,
      },

      reload: {
        fn: "reload",
        length: 1,
      },

      hostname: {
        getter: "getHostname",
        cache: true,
      },

      data: {
        getter: "getData",
        setter: "setData",
      },
    },
    finalize: true,
    construct: true,
    klass: {},
  }),
];
