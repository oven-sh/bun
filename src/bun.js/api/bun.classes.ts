import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "Subprocess",
    construct: true,
    noConstructor: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      pid: {
        getter: "getPid",
      },
      stdin: {
        getter: "getStdin",
        cache: true,
      },
      stdout: {
        getter: "getStdout",
        cache: true,
      },
      writable: {
        getter: "getStdin",
        cache: "stdin",
      },
      readable: {
        getter: "getStdout",
        cache: "stdout",
      },
      stderr: {
        getter: "getStderr",
        cache: true,
      },

      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },

      send: {
        fn: "doSend",
        length: 1,
      },

      kill: {
        fn: "kill",
        length: 1,
      },

      killed: {
        getter: "getKilled",
      },

      exitCode: {
        getter: "getExitCode",
      },
      signalCode: {
        getter: "getSignalCode",
      },

      exited: {
        getter: "getExited",
      },
    },
  }),
];
