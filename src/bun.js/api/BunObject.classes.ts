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
      maxRSS: {
        getter: "getMaxRSS",
      },
      shmSize: {
        getter: "getSharedMemorySize",
      },
      swapCount: {
        getter: "getSwapCount",
      },
      messages: {
        getter: "getMessages",
      },
      signalCount: {
        getter: "getSignalCount",
      },
      contextSwitches: {
        getter: "getContextSwitches",
        cache: true,
      },
      cpuTime: {
        getter: "getCPUTime",
        cache: true,
      },
      ops: {
        getter: "getOps",
        cache: true,
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
      stderr: {
        getter: "getStderr",
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
      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },
      resourceUsage: {
        fn: "resourceUsage",
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
      disconnect: {
        fn: "disconnect",
        length: 0,
      },
      connected: {
        getter: "getConnected",
      },
      "@@asyncDispose": {
        fn: "asyncDispose",
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
      stdio: {
        getter: "getStdio",
      },
    },
  }),
];
