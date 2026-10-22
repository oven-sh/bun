import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "ShellInterpreter",
    types: [{ path: ["$ZigGeneratedClasses", "ShellInterpreter"], isView: false, typeArguments: [] }],
    rustPath: "crate::shell::Interpreter",
    construct: true,
    noConstructor: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    values: ["resolve", "reject"],
    valuesArray: true,
    memoryCost: true,
    estimatedSize: true,
    proto: {
      run: {
        fn: "runFromJS",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
    },
  }),
];
