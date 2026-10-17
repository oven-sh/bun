import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "AroundHook",
    construct: false,
    noConstructor: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["context", "outerAsyncContext", "ready", "release", "done"],
    configurable: false,
    klass: {},
    proto: {},
  }),
];
