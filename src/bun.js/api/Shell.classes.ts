import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "ShellInterpreter",
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
