import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "FetchContext",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    values: ["checkServerIdentity", "onStats"],
    proto: {
      close: {
        fn: "close",
        length: 0,
      },
      "@@dispose": {
        fn: "close",
        length: 0,
      },
    },
  }),
];
