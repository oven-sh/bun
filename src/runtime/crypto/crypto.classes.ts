import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "Crypto",
    construct: true,
    finalize: true,

    proto: {
      getRandomValues: {
        fn: "getRandomValues",
      },
      randomUUID: {
        fn: "randomUUID",
        length: 1,
      },
      timingSafeEqual: {
        fn: "timingSafeEqual",
        length: 2,
      },
    },
    klass: {},
  }),
];
