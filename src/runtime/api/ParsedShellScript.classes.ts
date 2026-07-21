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
    // GC root for the `Bun.Terminal` wrapper attached via `setTerminal`.
    values: ["terminal"],
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
      setTerminal: {
        fn: "setTerminal",
        length: 1,
      },
    },
  }),
];
