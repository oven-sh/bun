import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Queue",
    construct: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      add: {
        fn: "add",
        length: 3,
      },
      process: {
        fn: "process",
        length: 2,
      },
      getJob: {
        fn: "getJob",
        length: 1,
      },
      removeJob: {
        fn: "removeJob",
        length: 1,
      },
      getStats: {
        fn: "getStats",
        length: 0,
      },
      getJobs: {
        fn: "getJobs",
        length: 3,
      },
      pause: {
        fn: "pause",
        length: 0,
      },
      resume: {
        fn: "resumeQueue",
        length: 0,
      },
      close: {
        fn: "close",
        length: 1,
      },
      on: {
        fn: "on",
        length: 2,
      },
    },
  }),
];
