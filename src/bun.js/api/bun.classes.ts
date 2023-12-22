import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "ResourceUsage",
    construct: true,
    noConstructor: true,
    finalize: true,
    configurable: false,
    hasPendingActivity: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      utime: {
        getter: "getUTime",
        cache: true,
      },
      stime: {
        getter: "getSTime",
        cache: true,
      },
      maxrss: {
        getter: "getMaxRSS",
      },
      ixrss: {
        getter: "getIXRSS",
      },
      idrss: {
        getter: "getIDRSS",
      },
      isrss: {
        getter: "getISRSS",
      },
      minflt: {
        getter: "getMinFLT",
      },
      majflt: {
        getter: "getMajFLT",
      },
      nswap: {
        getter: "getNSwap",
      },
      inblock: {
        getter: "getInBlock",
      },
      oublock: {
        getter: "getOuBlock",
      },
      msgsnd: {
        getter: "getMsgSnd",
      },
      msgrcv: {
        getter: "getMsgRcv",
      },
      nsignals: {
        getter: "getNSignals",
      },
      nvcsw: {
        getter: "getNVCSW",
      },
      nivcsw: {
        getter: "getNIVCSW",
      },
    },
    values: [],
  }),
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
      stats: {
        fn: "stats",
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
