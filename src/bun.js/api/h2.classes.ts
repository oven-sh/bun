import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "H2FrameParser",
    JSType: "0b11101110",
    proto: {
      request: {
        fn: "request",
        length: 2,
      },
      ping: {
        fn: "ping",
        length: 0,
      },
      goaway: {
        fn: "goaway",
        length: 3,
      },
      getCurrentState: {
        fn: "getCurrentState",
        length: 0,
      },
      settings: {
        fn: "updateSettings",
        length: 1,
      },
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
