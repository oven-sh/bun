import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "CronJob",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      stop: {
        fn: "stop",
        length: 0,
      },
      "@@dispose": {
        fn: "stop",
        length: 0,
      },
      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },
      cron: {
        getter: "getCron",
        cache: true,
      },
    },
    values: ["callback", "pendingPromise"],
  }),
];
