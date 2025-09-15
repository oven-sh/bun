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
        length: 2,
      },
      worker: {
        fn: "worker",
        length: 1,
      },
    },
  }),
];
