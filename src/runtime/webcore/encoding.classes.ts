import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "TextDecoder",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      encoding: {
        getter: "getEncoding",
        type: "string",
        cache: true,
      },
      fatal: {
        getter: "getFatal",
        type: "boolean",
        pure: true,
      },
      ignoreBOM: {
        getter: "getIgnoreBOM",
        type: "boolean",
        pure: true,
      },

      decode: {
        fn: "decode",
        returns: "string",
        checkedAtRuntime: true,
        length: 1,
      },
    },
  }),
];
