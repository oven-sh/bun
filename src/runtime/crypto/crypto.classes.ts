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
        returns: "string",
        checkedAtRuntime: true,
        length: 1,
      },
      timingSafeEqual: {
        fn: "timingSafeEqual",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 2,
      },
    },
    klass: {},
  }),
];
