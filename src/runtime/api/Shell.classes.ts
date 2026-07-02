import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "ShellInterpreter",
    rustPath: "crate::shell::Interpreter",
    construct: true,
    noConstructor: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    // `terminal` roots the `Bun.Terminal` wrapper for the lifetime of the run.
    values: ["resolve", "reject", "terminal"],
    valuesArray: true,
    memoryCost: true,
    estimatedSize: true,
    proto: {
      run: {
        fn: "runFromJS",
        length: 0,
      },
      isRunning: {
        fn: "isRunning",
        length: 0,
      },
      started: {
        fn: "getStarted",
        length: 0,
      },
    },
  }),
];
