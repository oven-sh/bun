import { define } from "../../codegen/class-definitions.ts";

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
        type: "number",
      },
      shmSize: {
        getter: "getSharedMemorySize",
        type: "number",
      },
      swapCount: {
        getter: "getSwapCount",
        type: "number",
      },
      messages: {
        getter: "getMessages",
        type: "object",
        checkedAtRuntime: true,
      },
      signalCount: {
        getter: "getSignalCount",
        type: "number",
      },
      contextSwitches: {
        getter: "getContextSwitches",
        type: "object",
        checkedAtRuntime: true,
        cache: true,
      },
      cpuTime: {
        getter: "getCPUTime",
        type: "object",
        checkedAtRuntime: true,
        cache: true,
      },
      ops: {
        getter: "getOps",
        type: "object",
        checkedAtRuntime: true,
        cache: true,
      },
    },
    values: [],
  }),
  define({
    name: "Subprocess",
    types: [{ path: ["$ZigGeneratedClasses", "Subprocess"], isView: false, typeArguments: [] }],
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    noConstructor: true,
    refCounted: true,
    configurable: false,
    memoryCost: true,
    klass: {},
    JSType: "0b11101110",
    proto: {
      pid: {
        getter: "getPid",
        type: "int32",
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
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      unref: {
        fn: "doUnref",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      resourceUsage: {
        fn: "resourceUsage",
        returns: "ResourceUsage | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      send: {
        fn: "doSend",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
      kill: {
        fn: "kill",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      disconnect: {
        fn: "disconnect",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      connected: {
        getter: "getConnected",
        type: "boolean",
      },
      "@@asyncDispose": {
        fn: "asyncDispose",
        returns: "Promise | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      killed: {
        getter: "getKilled",
        type: "boolean",
      },
      exitCode: {
        getter: "getExitCode",
        type: "number | null",
      },
      signalCode: {
        getter: "getSignalCode",
        type: "string | number | null",
        checkedAtRuntime: true,
      },
      exited: {
        getter: "getExited",
        type: "Promise",
        this: true,
      },
      stdio: {
        getter: "getStdio",
        type: "Array",
        checkedAtRuntime: true,
      },
      terminal: {
        getter: "getTerminal",
        type: "Terminal | undefined",
        checkedAtRuntime: true,
        cache: true,
      },
    },
    values: ["exitedPromise", "onExitCallback", "onDisconnectCallback", "ipcCallback"],
  }),
];
