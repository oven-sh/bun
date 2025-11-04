import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "ParsedShellScript",
    construct: true,
    noConstructor: true,
    finalize: true,
    hasPendingActivity: false,
    configurable: false,
    valuesArray: true,
    memoryCost: true,
    estimatedSize: true,
    klass: {},
    proto: {
      setCwd: {
        fn: "setCwd",
        length: 1,
      },
      setEnv: {
        fn: "setEnv",
        length: 1,
      },
      setQuiet: {
        fn: "setQuiet",
        length: 1,
      },
    },
  }),
];
