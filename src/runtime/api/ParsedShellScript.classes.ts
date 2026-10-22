import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "ParsedShellScript",
    types: [{ path: ["$ZigGeneratedClasses", "ParsedShellScript"], isView: false, typeArguments: [] }],
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
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      setEnv: {
        fn: "setEnv",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      setQuiet: {
        fn: "setQuiet",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
    },
  }),
];
