import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "ParsedShellScript",
    construct: true,
    noConstructor: true,
    finalize: true,
    hasPendingActivity: false,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    values: ["resolve", "reject"],
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
        length: 0,
      },
      setResolveAndReject: {
        fn: "setResolveAndReject",
        length: 2,
      },
    },
  }),
];
