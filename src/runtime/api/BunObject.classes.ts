import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Subprocess",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    noConstructor: true,
    finalize: true,
    configurable: false,
    memoryCost: true,
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
        this: true,
      },
      stdio: {
        getter: "getStdio",
      },
      terminal: {
        getter: "getTerminal",
        cache: true,
      },
    },
    values: ["exitedPromise", "onExitCallback", "onDisconnectCallback", "ipcCallback"],
  }),
];
