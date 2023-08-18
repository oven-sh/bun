import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "FFI",
    construct: true,
    noConstructor: true,
    finalize: true,
    klass: {},
    proto: {
      close: {
        fn: "close",
        length: 0,
      },

      symbols: {
        cache: "symbolsValue",
        getter: "getSymbols",
      },
    },
    values: ["symbolsValue"],
  }),
];
