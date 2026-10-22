import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "FetchSession",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    values: ["checkServerIdentity"],
    proto: {
      fetch: {
        getter: "getFetch",
        type: "object",
        checkedAtRuntime: true,
        cache: true,
        this: true,
      },
      close: {
        fn: "close",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      "@@dispose": {
        fn: "close",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
    },
  }),
];
