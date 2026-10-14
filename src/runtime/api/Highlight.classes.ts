import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "HighlightTheme",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      ansi: {
        fn: "ansi",
        length: 2,
      },
      css: {
        fn: "css",
        length: 0,
      },
    },
  }),
];
