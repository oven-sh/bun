import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "ViWait",
    construct: false,
    noConstructor: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["callback", "promise", "lastError", "timeoutError"],
    configurable: false,
    klass: {},
    proto: {},
  }),
];
