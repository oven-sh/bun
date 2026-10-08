import { define } from "../../codegen/class-definitions.ts";

const member = (getter: string) => ({ getter, cache: true, this: true }) as const;

export default [
  define({
    name: "TestContext",
    construct: false,
    noConstructor: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["result", "errors", "annotations", "fixtures"],
    configurable: false,
    klass: {},
    proto: {
      task: member("getTask"),
      expect: member("getExpect"),
      signal: member("getSignal"),
      skip: member("getSkip"),
      onTestFinished: member("getOnTestFinished"),
      onTestFailed: member("getOnTestFailed"),
      annotate: member("getAnnotate"),
    },
  }),
];
