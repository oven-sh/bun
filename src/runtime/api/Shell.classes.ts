import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "ShellInterpreter",
    rustPath: "crate::shell::Interpreter",
    construct: true,
    noConstructor: true,
    refCounted: true,
    configurable: false,
    klass: {},
    values: ["resolve", "reject", "jsobjs"],
    memoryCost: true,
    estimatedSize: true,
    proto: {
      run: {
        fn: "runFromJS",
        length: 0,
      },
    },
  }),
];
