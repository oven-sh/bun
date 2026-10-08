import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "ExpectDeferred",
    construct: false,
    noConstructor: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["expect", "call", "promise", "callSite", "awaited"],
    configurable: false,
    klass: {},
    proto: {},
  }),
];
