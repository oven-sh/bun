import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "PostgresSQLConnection",
    construct: true,
    finalize: true,
    configurable: false,
    hasPendingActivity: true,
    klass: {
      //   escapeString: {
      //     fn: "escapeString",
      //   },
      //   escapeIdentifier: {
      //     fn: "escapeIdentifier",
      //   },
    },
    JSType: "0b11101110",
    proto: {
      close: {
        fn: "doClose",
      },
      connected: {
        getter: "getConnected",
      },
      ref: {
        fn: "doRef",
      },
      unref: {
        fn: "doUnref",
      },
      flush: {
        fn: "doFlush",
      },

      queries: {
        getter: "getQueries",
        this: true,
      },
      onconnect: {
        getter: "getOnConnect",
        setter: "setOnConnect",
        this: true,
      },
      onclose: {
        getter: "getOnClose",
        setter: "setOnClose",
        this: true,
      },
    },
    values: ["onconnect", "onclose", "queries"],
  }),
  define({
    name: "PostgresSQLQuery",
    construct: true,
    finalize: true,
    configurable: false,

    JSType: "0b11101110",
    klass: {},
    proto: {
      run: {
        fn: "doRun",
        length: 2,
      },
      cancel: {
        fn: "doCancel",
        length: 0,
      },
      done: {
        fn: "doDone",
        length: 0,
      },
      setMode: {
        fn: "setMode",
        length: 1,
      },
      setPendingValue: {
        fn: "setPendingValue",
        length: 1,
      },
    },
    values: ["pendingValue", "target", "columns", "binding"],
    estimatedSize: true,
  }),
];
