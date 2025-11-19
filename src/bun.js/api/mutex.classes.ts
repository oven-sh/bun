import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Mutex",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      lock: {
        fn: "lock",
        length: 0,
      },
      unlock: {
        fn: "unlock",
        length: 0,
      },
      tryLock: {
        fn: "tryLock",
        length: 0,
      },
    },
  }),
];
