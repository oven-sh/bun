import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "H2FrameParser",
    JSType: "0b11101110",
    proto: {
      read: {
        fn: "read",
        length: 1,
      },
      detach: {
        fn: "detach",
        length: 0,
      },
    },
    finalize: true,
    construct: true,
    klass: {},
  }),
];
