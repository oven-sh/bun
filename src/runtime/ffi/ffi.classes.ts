import { define } from "../../codegen/class-definitions.ts";

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
        returns: "undefined",
        checkedAtRuntime: true,
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
