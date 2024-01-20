import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "ShellInterpreter",
    construct: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      run: {
        fn: "runFromJS",
        length: 0,
      },
      isRunning: {
        fn: "isRunning",
        length: 0,
      },
      setResolve: {
        fn: "setResolve",
        length: 1,
      },
      setReject: {
        fn: "setReject",
        length: 1,
      },
      started: {
        fn: "getStarted",
        length: 0,
      },
      getBufferedStdout: {
        fn: "getBufferedStdout",
        length: 0,
      },
      getBufferedStderr: {
        fn: "getBufferedStderr",
        length: 0,
      },
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
    },
  }),
];
