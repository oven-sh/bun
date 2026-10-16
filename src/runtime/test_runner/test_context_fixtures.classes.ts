import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "TestFixtures",
    construct: false,
    noConstructor: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["values", "scoped"],
    configurable: false,
    klass: {},
    proto: {},
  }),
  define({
    name: "ActiveFixture",
    construct: false,
    noConstructor: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["fixtures", "context", "value", "ready", "release", "returned", "cleanup"],
    configurable: false,
    klass: {},
    proto: {},
  }),
];
