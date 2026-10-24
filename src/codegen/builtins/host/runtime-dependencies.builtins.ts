import * as b from "bun-builtins-table";
import {
  asyncContextCell,
  drainMicrotasksCell,
  emitsProcessEventCell,
  emitsWarningCell,
  environmentCell,
  featuresCell,
  flushesDirectStreamCell,
  handedWarningsCell,
  inspectCell,
  inspectOptionsCell,
  madeWarningsCell,
  nextTickQueueCell,
  onWarningCell,
  releaseCell,
  reportsExceptionCell,
  setModuleWrapperCell,
  standardErrorCell,
  stylizeWithColorCell,
  stylizeWithNoColorCell,
  throwsWarningCell,
  tickShownToHooksCell,
  versionsCell,
  writeWarningCell,
} from "./native-cells.ts";

const functionsIn = (file: string, ...names: readonly string[]): b.FunctionRef[] =>
  names.map(name => b.functionIn(file, name));

const evaluates = (...modules: readonly string[]): b.ModuleLoadSpec[] =>
  modules.map(module => ({ module, exports: [] }));

const channelModules = evaluates(
  "node:net",
  "node:dgram",
  "internal/dgram",
  "node:fs",
  "internal/serialization_buffers",
);

const standardStreamModules = evaluates("node:tty", "node:fs", "internal/fs/streams");

const loadedModulesByPath: Readonly<Record<b.BuiltinPath, readonly b.ModuleLoadSpec[]>> = {
  "Bun.spawn": channelModules,
  "console._stderr": standardStreamModules,
  "console._stdout": standardStreamModules,
  "node:child_process": channelModules,
  "node:fs/promises": evaluates("internal/fifo"),
  "node:repl": standardStreamModules,
  "node:worker_threads": evaluates("internal/worker/stdio"),
  "process.channel": [...channelModules, ...evaluates("node:events")],
  "process.disconnect": channelModules,
  "process.nextTick": [
    {
      module: "internal/process/next_tick_queue",
      exports: [
        b.exportRead("nextTick", b.isValueOf("process.nextTick")),
        b.exportRead("ring", b.memberOfValue("pushWithInitHooks", b.keptIn(tickShownToHooksCell))),
      ],
    },
  ],
  "process.openStdin": standardStreamModules,
  "process.send": channelModules,
  "process.stderr": standardStreamModules,
  "process.stdin": standardStreamModules,
  "process.stdout": standardStreamModules,
};

const bundlerPluginFunctions = functionsIn(
  "builtins/BundlerPlugin",
  "loadAndResolvePluginsForServe",
  "runOnEndCallbacks",
  "runOnLoadPlugins",
  "runOnResolvePlugins",
  "runSetupFunction",
);

// A server runs the plugins that bunfig names, which are code from outside the executable.
const pluginFunctionsOfServer = bundlerPluginFunctions.map(called => ({
  function: called,
  when: b.whenBuildAdmitsRuntimeCode,
}));

const channelFunctions = functionsIn(
  "builtins/Ipc",
  "parseHandle",
  "restoreAdvancedBuffers",
  "serialize",
  "tagAdvancedBuffers",
);

const whenChannelEvent = b.whenOperandOfCallOn("process", "event", "message", "disconnect");

// Not process.connected: its getter answers a flag of native code and its setter does nothing (BunProcess.cpp processConnected, setProcessConnected): neither opens the channel.
const channelUsers: readonly b.CallingEntrySpec[] = [
  "Bun.spawn",
  "node:child_process",
  "node:cluster",
  "process.channel",
  "process.disconnect",
  "process.send",
  ...["addListener", "on", "once", "prependListener", "prependOnceListener"].map(name => ({
    path: `%EventEmitter%.prototype.${name}`,
    when: whenChannelEvent,
  })),
];

const processObject = b.builtin("process");
const globalObject = b.builtin("globalThis");
const consoleObject = b.builtin("console");
const processInternal = (name: string) => b.functionIn("builtins/ProcessObjectInternals", name);

const kindOfDescriptor = b.int(0, 2);

// In a worker of node:worker_threads the stream goes to a port of the parent, which native code has from the Worker's options.
const streamOfWorker = (descriptor: number, stream: b.BuiltinPath, ...otherUses: readonly b.HostUseSpec[]) =>
  b.functionUsed(
    processInternal("getNodeWorkerStdioStream"),
    b.calledByHost({
      times: "Once",
      this: globalObject,
      args: [processObject, b.int(descriptor, descriptor), b.nativeMemory],
      result: [b.isValueOf(stream), ...otherUses],
    }),
  );

const standardInputFunctionsOf = (stream: b.BuiltinPath) => [
  streamOfWorker(0, stream),
  b.functionUsed(
    processInternal("getStdinStream"),
    b.calledByHost({
      times: "Once",
      this: globalObject,
      args: [processObject, b.int(0, 0), b.bool, kindOfDescriptor],
      result: [b.isValueOf(stream)],
    }),
  ),
];

// The function answers the stream and its sink, in which native code sets a flag.
const standardOutputFunctionsOf = (
  descriptor: 1 | 2,
  stream: b.BuiltinPath,
  ...otherUses: readonly b.HostUseSpec[]
) => [
  streamOfWorker(descriptor, stream, ...otherUses),
  b.functionUsed(
    processInternal("getStdioWriteStream"),
    b.calledByHost({
      times: "Once",
      this: globalObject,
      args: [processObject, b.int(descriptor, descriptor), b.bool, kindOfDescriptor],
      result: [b.memberOfValue(0, b.isValueOf(stream), ...otherUses), b.memberOfValue(1, b.inspectedByHost)],
    }),
  ),
];

// Once the program has the stream, the function that prints a warning writes through it.
const writtenByWarnings = [
  b.keptIn(standardErrorCell),
  b.memberOfValue(
    "write",
    b.calledByHost({ times: "Repeatedly", this: b.nativeCell(standardErrorCell), args: [b.string], result: b.dropped }),
  ),
];

// Native code makes the value of the property by a call without operands, or with `process`.
const builtBy = (name: string, property: b.BuiltinPath, ...args: readonly b.TableType[]) => [
  b.functionUsed(
    processInternal(name),
    b.calledByHost({ times: "Once", this: globalObject, args, result: [b.isValueOf(property)] }),
  ),
];

// The object of the function is what the property holds.
const heldAs = (called: b.FunctionRef, property: b.BuiltinPath) => b.functionUsed(called, b.isValueOf(property));

// Nothing says yet which native code makes these streams and what it does with them.
const standardInputFunctions = functionsIn(
  "builtins/ProcessObjectInternals",
  "getNodeWorkerStdioStream",
  "getStdinStream",
);

// The host brings the list behind `module.children` up to date: (list, child). What the program has stored in the list's place is out of sight from the store on, and the analysis lets the children go with it.
const moduleChildrenFunctions = [
  b.functionUsed(
    b.functionIn("builtins/CommonJS", "pushObservableChild"),
    b.calledByHost({
      times: "Repeatedly",
      args: [b.instance("Array").holding({ element: b.builtin("%ModuleObject%") }), b.builtin("%ModuleObject%")],
      result: b.dropped,
    }),
  ),
];

const requireCacheFunctions = [...functionsIn("builtins/CommonJS", "createRequireCache"), ...moduleChildrenFunctions];

const fusedTraversalFunctions = functionsIn("prelude/array-traversal", "traverseArray");

const streamedModuleFunctions = functionsIn("builtins/WasmStreaming", "consumeStream");

const jsonTextFunctions = functionsIn("prelude/json", "stringifyElement", "stringifyProperties", "stringifyProperty");

const calledFunctionsByPath: Readonly<Record<b.BuiltinPath, readonly b.CalledFunctionSpec[]>> = {
  "%ModuleObject%.children": moduleChildrenFunctions,
  "%ModuleObject%.parent": moduleChildrenFunctions,
  "%ModuleRequire%.cache": requireCacheFunctions,
  "%ModuleRequire%.main": [...functionsIn("builtins/CommonJS", "main"), ...moduleChildrenFunctions],
  "%ModuleRequire%.resolve": functionsIn("builtins/CommonJS", "requireResolve"),
  "Array.prototype.filter": fusedTraversalFunctions,
  "Array.prototype.flatMap": fusedTraversalFunctions,
  "Array.prototype.map": fusedTraversalFunctions,
  "Array.prototype.slice": fusedTraversalFunctions,
  "Buffer.from": functionsIn("builtins/JSBufferConstructor", "from"),
  "Buffer.isBuffer": functionsIn("builtins/JSBufferConstructor", "isBuffer"),
  "Buffer.prototype.offset": functionsIn("builtins/JSBufferPrototype", "offset"),
  "Buffer.prototype.parent": functionsIn("builtins/JSBufferPrototype", "parent"),
  "Buffer.prototype.toJSON": functionsIn("builtins/JSBufferPrototype", "toJSON"),
  "Bun.$": functionsIn("builtins/shell", "createBunShellTemplateFunction"),
  "Bun.Glob": functionsIn("builtins/Glob", "scan", "scanSync"),
  "Bun.build": bundlerPluginFunctions,
  "Bun.peek": [heldAs(b.functionIn("builtins/Peek", "peek"), "Bun.peek"), b.functionIn("builtins/Peek", "peekStatus")],
  "Bun.plugin": bundlerPluginFunctions,
  "Bun.serve": pluginFunctionsOfServer,
  "JSON.stringify": jsonTextFunctions,
  "Response.json": jsonTextFunctions,
  "WebAssembly.compileStreaming": streamedModuleFunctions,
  "WebAssembly.instantiateStreaming": streamedModuleFunctions,
  // The getter calls it on `console`, with `console`, and what it answers takes the getter's place.
  "console.Console": [
    b.functionUsed(
      b.functionIn("builtins/ConsoleObject", "createConsoleConstructor"),
      b.calledByHost({
        times: "Once",
        this: consoleObject,
        args: [consoleObject],
        result: [b.isValueOf("console.Console")],
      }),
    ),
  ],
  // They read process.stderr and process.stdout, and hold what they find.
  "console._stderr": standardOutputFunctionsOf(2, "console._stderr", ...writtenByWarnings),
  "console._stdout": standardOutputFunctionsOf(1, "console._stdout"),
  "node:fs/promises": functionsIn("builtins/Fifo", "createFIFO"),
  "node:module": [
    b.functionUsed(
      b.functionIn("builtins/CommonJS", "getWrapperArrayProxy"),
      b.calledByHost({
        times: "Repeatedly",
        this: b.undefined,
        args: [b.nativeCell(setModuleWrapperCell), b.string, b.string],
        result: [b.isValueOf("node:module.wrapper")],
      }),
    ),
    ...functionsIn("builtins/CommonJS", "requireESMFromHijackedExtension"),
  ],
  "node:module._initPaths": [heldAs(b.functionIn("builtins/NodeModuleObject", "_initPaths"), "node:module._initPaths")],
  "node:module._cache": requireCacheFunctions,
  "process._rawDebug": [heldAs(processInternal("rawDebug"), "process._rawDebug")],
  "process.allowedNodeEnvironmentFlags": builtBy(
    "buildAllowedNodeEnvironmentFlags",
    "process.allowedNodeEnvironmentFlags",
  ),
  "process.channel": builtBy("getChannel", "process.channel"),
  "process.finalization": builtBy("createProcessFinalization", "process.finalization", processObject),
  "process.loadEnvFile": [heldAs(processInternal("loadEnvFile"), "process.loadEnvFile")],
  "process.mainModule": moduleChildrenFunctions,
  "process.openStdin": standardInputFunctions,
  "process.stderr": standardOutputFunctionsOf(2, "process.stderr", ...writtenByWarnings),
  "process.stdin": standardInputFunctionsOf("process.stdin"),
  "process.stdout": standardOutputFunctionsOf(1, "process.stdout"),
};

const inBindings = (file: string): string => `src/jsc/bindings/${file}`;

// The object warns about a value that is stored into it and is no string, number or boolean. A read of it runs nothing.
const environmentObjects = ["%ImportMeta%.env", "Bun.env", "process.env"].map(path => ({
  path,
  when: b.whenObjectNobodyKnowsIsWritten,
}));

const workerConstructors = ["Worker", "native:Cpp:Worker.cpp:createNodeWorkerConstructor"];

const messagePortSources = ["MessageChannel", "MessagePort", "native:Cpp:Worker.cpp:createNodeWorkerThreadsBinding"];

// An instance of a class counts as a use of the class and of those above it, whoever hands it out.
const eventTargetSources = [
  "AbortController",
  "AbortSignal",
  "BroadcastChannel",
  "Bun.WebView",
  "EventTarget",
  "Performance",
  "WebSocket",
  "addEventListener",
  "native:Cpp:JSWebSocket.cpp:createWebSocketBindingForWs",
  "onerror",
  "onmessage",
  "EventTarget.prototype.addEventListener",
  "Performance.prototype.onresourcetimingbufferfull",
  ...messagePortSources,
  ...workerConstructors,
];

const nodeCryptoBinding = ["native:Cpp:node_crypto_binding.cpp:createNodeCryptoBinding"];

// The run time reports a promise that is rejected without a handler, and one that gets its handler afterwards.
const promises = ["Promise"];

// The overload for a delay that fits a timer says that it runs no code.
const timersWithOtherDelays = ["setInterval", "setTimeout"].map(path => ({ path, when: b.whenCallRunsOtherCode }));

// Each takes its callback first, and queues it with the error where it fails before anything is scheduled.
const fsMethodsTakingCallback = [
  "access",
  "appendFile",
  "close",
  "copyFile",
  "exists",
  "chown",
  "chmod",
  "fchmod",
  "fchown",
  "fstat",
  "fsync",
  "ftruncate",
  "futimes",
  "lchmod",
  "lchown",
  "link",
  "lstat",
  "mkdir",
  "mkdtemp",
  "open",
  "read",
  "write",
  "readFile",
  "writeFile",
  "readlink",
  "rm",
  "rmdir",
  "realpath",
  "realpathNative",
  "rename",
  "stat",
  "statfs",
  "symlink",
  "truncate",
  "unlink",
  "utimes",
  "lutimes",
  "writev",
  "readv",
  "fdatasync",
  "readdir",
].map(name => `%NodeJSFS%.prototype.${name}Cb`);

// What it answers is process.nextTick.
const nextTickMadeBy = (...otherUses: readonly b.HostUseSpec[]) => [
  b.functionUsed(
    processInternal("initializeNextTickQueue"),
    b.calledByHost({
      times: "Once",
      this: globalObject,
      args: [processObject, b.nativeCell(nextTickQueueCell), b.nativeCell(drainMicrotasksCell)],
      result: [b.isValueOf("process.nextTick"), ...otherUses],
    }),
  ),
];
const nextTickMaker = nextTickMadeBy();
// Native code reads process.nextTick and queues with it the functions that it was handed, each with what it was handed for them.
const tickFunctions = nextTickMadeBy(
  b.calledByHost({
    times: "Repeatedly",
    this: b.undefined,
    args: [b.nativeMemory],
    otherArgs: b.nativeMemory,
    result: b.dropped,
  }),
);

// Where native code queues a function of its own, the function is known, whatever it is queued with.
const queuedByNativeCode = (cell: string, ...args: readonly b.PlaceLike[]) =>
  nextTickMadeBy(
    b.calledByHost({ times: "Repeatedly", this: b.undefined, args: [b.nativeCell(cell), ...args], result: b.dropped }),
  );

// What it answers prints a warning. The listener that is on `process` from the start hands it what the listener is called with, and answers what it answers.
const warningPrinterCalledWith = (...warnings: readonly b.PlaceLike[]) => [
  b.functionUsed(
    processInternal("createOnWarning"),
    b.calledByHost({
      times: "Once",
      this: b.undefined,
      args: [
        processObject,
        b.string.or(b.undefined),
        b.instance("Array").holding({ element: b.string }).fresh.or(b.undefined),
        b.nativeCell(writeWarningCell),
      ],
      result: [
        b.keptIn(onWarningCell),
        ...warnings.map(warning => b.calledByHost({ times: "PerEvent", this: processObject, args: [warning] })),
      ],
    }),
  ),
];
// A program that emits the event by itself, or takes the listener out of the list and calls it, passes what it likes.
const warningPrinterFunctions = warningPrinterCalledWith(b.nativeMemory);

// A warning is emitted on the next tick, to a listener that is on `process` from the start: native code queues a function of its own with the warning.
const emittedWarnings = [madeWarningsCell, handedWarningsCell].map(cell => b.nativeCell(cell));
const queuedWithWarning = (cell: string) =>
  emittedWarnings.map(warning =>
    b.calledByHost({ times: "Repeatedly", this: b.undefined, args: [b.nativeCell(cell), warning], result: b.dropped }),
  );
const warningFunctions = [
  ...warningPrinterCalledWith(...emittedWarnings),
  ...nextTickMadeBy(...queuedWithWarning(emitsWarningCell), ...queuedWithWarning(throwsWarningCell)),
];
// Of native code that nothing describes, nobody knows what it emits as a warning.
const warningFunctionsOfUndeclaredCode = [...warningPrinterFunctions, ...tickFunctions];

const nativeCalls = [
  b.nativeCalls({
    through: ["ensureOnWarning"],
    calls: warningPrinterFunctions,
    otherMentions: [{ file: inBindings("BunProcess.cpp") }, { file: inBindings("BunProcess.h") }],
    callers: [
      {
        file: inBindings("BunProcess.cpp"),
        caller: "Process_functionDefaultOnWarning",
        onBehalfOf: [
          "%EventEmitter%.prototype.emit",
          "%EventEmitter%.prototype.listeners",
          "%EventEmitter%.prototype.rawListeners",
        ],
      },
    ],
  }),
  b.nativeCalls({
    through: [
      "Bun__Process__emitWarning",
      "Bun__promises__emitUnhandledRejectionWarning",
      "emitWarning",
      "emitWarningErrorInstance",
      "emit_warning",
    ],
    calls: warningFunctions,
    otherMentions: [
      { file: "src/jsc/JSGlobalObject.rs", times: 3 },
      { file: "src/jsc/VirtualMachine.rs" },
      { file: inBindings("BunProcess.cpp"), times: 6 },
      { file: inBindings("BunProcess.h"), times: 2 },
      { file: inBindings("webcore/MessagePort.cpp") },
    ],
    callers: [
      { file: "src/jsc/VirtualMachine.rs", caller: "unhandled_rejection_owned", times: 4, onBehalfOf: promises },
      {
        file: inBindings("BunProcess.cpp"),
        caller: "Bun__promises__emitUnhandledRejectionWarning",
        times: 2,
        onBehalfOf: promises,
      },
      { file: inBindings("BunProcess.cpp"), caller: "Bun__emitHandledPromiseEvent", onBehalfOf: promises },
      { file: inBindings("BunProcess.cpp"), caller: "Process_emitWarning", onBehalfOf: ["process.emitWarning"] },
      { file: inBindings("BunProcess.cpp"), caller: "Process_functionBinding", onBehalfOf: ["process.binding"] },
      { file: inBindings("BunProcess.cpp"), caller: "Process_functionExecve", onBehalfOf: ["process.execve"] },
      {
        file: inBindings("JSEnvironmentVariableMap.cpp"),
        caller: "maybeEmitEnvNonstringDeprecation",
        onBehalfOf: environmentObjects,
      },
      { file: inBindings("ProcessBindingUV.cpp"), caller: "jsErrname", onBehalfOf: ["process.binding"] },
      {
        file: inBindings("node/crypto/CryptoGenRsaKeyPair.cpp"),
        caller: "RsaKeyPairJobCtx::fromJS",
        times: 2,
        onBehalfOf: nodeCryptoBinding,
      },
      {
        file: inBindings("node/crypto/JSKeyObjectConstructor.cpp"),
        caller: "jsKeyObjectConstructor_from",
        onBehalfOf: nodeCryptoBinding,
      },
      {
        file: inBindings("node/crypto/KeyObject.cpp"),
        caller: "emitCryptoKeyDeprecationWarning",
        onBehalfOf: nodeCryptoBinding,
      },
      {
        file: inBindings("webcore/JSEventTarget.cpp"),
        caller: "jsEventTargetPrototypeFunction_addEventListenerBody",
        onBehalfOf: eventTargetSources,
      },
      {
        file: inBindings("webcore/MessagePort.cpp"),
        caller: "MessagePort::postMessage",
        onBehalfOf: messagePortSources,
      },
      { file: "src/runtime/ipc.rs", caller: "on_ack_nack", onBehalfOf: channelUsers },
      { file: "src/runtime/timer/Timer.rs", caller: "warn_invalid_countdown", onBehalfOf: timersWithOtherDelays },
    ],
  }),
  b.nativeCalls({
    through: ["constructNextTickFn"],
    calls: nextTickMaker,
    otherMentions: [{ file: inBindings("BunProcess.cpp") }, { file: inBindings("BunProcess.h") }],
    callers: [
      { file: inBindings("BunProcess.cpp"), caller: "constructProcessNextTickFn", onBehalfOf: ["process.nextTick"] },
    ],
  }),
  b.nativeCalls({
    through: [
      "Bun__Process__queueNextTick1",
      "Bun__Process__queueNextTick2",
      "call_next_tick_1",
      "call_next_tick_2",
      "emitOnNextTick",
      "queueNextTick",
    ],
    calls: tickFunctions,
    otherMentions: [
      { file: "src/jsc/JSValue.rs", times: 3 },
      { file: inBindings("BunProcess.cpp"), times: 15 },
      { file: inBindings("BunProcess.h"), times: 5 },
      { file: inBindings("webcore/streams/JSDirectStreamController.cpp") },
      { file: "src/runtime/node/node_crypto_binding.rs", times: 4 },
    ],
    callers: [
      {
        file: inBindings("webcore/JSEventListener.cpp"),
        caller: "jsFunctionEmitUncaughtExceptionNextTick",
        onBehalfOf: eventTargetSources,
        calls: queuedByNativeCode(reportsExceptionCell, b.nativeMemory),
      },
      {
        file: inBindings("webcore/JSWorker.cpp"),
        caller: "JSWorkerDOMConstructor::construct",
        onBehalfOf: workerConstructors,
        calls: queuedByNativeCode(emitsProcessEventCell, b.string, b.nativeMemory),
      },
      {
        file: inBindings("webcore/streams/JSDirectStreamController.cpp"),
        caller: "JSDirectStreamController::armEndOfTickFlush",
        onBehalfOf: ["ReadableStream"],
        calls: queuedByNativeCode(flushesDirectStreamCell, b.undefined, b.nativeMemory),
      },
      { file: "src/runtime/ipc.rs", caller: "abort_unsent", onBehalfOf: channelUsers },
      { file: "src/runtime/ipc.rs", caller: "call_next_tick", times: 2, onBehalfOf: channelUsers },
      { file: "src/runtime/ipc.rs", caller: "complete", onBehalfOf: channelUsers },
      { file: "src/runtime/ipc.rs", caller: "on_ack_nack", onBehalfOf: channelUsers },
      { file: "src/runtime/ipc_host.rs", caller: "do_send_err", times: 2, onBehalfOf: channelUsers },
      {
        file: "src/runtime/node/node_crypto_binding.rs",
        caller: "random_int",
        onBehalfOf: ["native:Bindgen:node_crypto_binding.bind.ts:crypto"],
      },
      {
        file: "src/runtime/node/node_fs_binding.rs",
        caller: "reject_before_schedule",
        onBehalfOf: fsMethodsTakingCallback,
      },
    ],
  }),
  b.nativeCalls({
    through: [
      "createEnvironmentVariablesMap",
      "m_processEnvObject.get",
      "m_processEnvObject.getInitializedOnMainThread",
      "processEnvObject",
    ],
    calls: functionsIn("builtins/ProcessObjectInternals", "windowsEnv"),
    otherMentions: [
      { file: inBindings("JSEnvironmentVariableMap.cpp") },
      { file: inBindings("JSEnvironmentVariableMap.h") },
      { file: inBindings("JSPropertyIterator.cpp") },
      { file: inBindings("ZigGlobalObject.cpp"), times: 4 },
      { file: inBindings("ZigGlobalObject.h") },
      { file: inBindings("webcore/JSWorker.cpp") },
    ],
    callers: [
      { file: inBindings("BunObject.cpp"), caller: "constructEnvObject", onBehalfOf: ["Bun.env"] },
      { file: inBindings("BunProcess.cpp"), caller: "Process_functionExecve", onBehalfOf: ["process.execve"] },
      { file: inBindings("BunProcess.cpp"), caller: "constructEnv", onBehalfOf: ["process.env"] },
      {
        file: inBindings("BunProcess.cpp"),
        caller: "constructReportObjectComplete",
        onBehalfOf: ["process.report.getReport"],
      },
      {
        file: inBindings("BunProcessReportObjectWindows.cpp"),
        caller: "constructReportObjectWindows",
        onBehalfOf: ["process.report.getReport"],
      },
      {
        file: inBindings("ImportMetaObject.cpp"),
        caller: "jsImportMetaObjectGetter_env",
        onBehalfOf: ["%ImportMeta%.env"],
      },
      {
        file: inBindings("JSEnvironmentVariableMap.cpp"),
        caller: "ensureSharedEnvStoreForWorker",
        onBehalfOf: workerConstructors,
      },
    ],
  }),
];

// Whoever names it calls `inspect` of a start-up module: the host where it calls the custom inspect method of an operand, the prompt, which no executable has, and the method by which a class of the host prints itself.
const callsOfInspect = b.nativeCalls({
  through: ["utilInspectFunction"],
  calls: [],
  otherMentions: [
    { file: inBindings("UtilInspect.cpp") },
    { file: inBindings("ZigGlobalObject.cpp"), times: 2 },
    { file: inBindings("ZigGlobalObject.h") },
    { file: inBindings("bindings.cpp") },
    { file: inBindings("webcore/JSBroadcastChannel.cpp") },
    { file: inBindings("webcore/JSPerformanceEntry.cpp") },
    { file: inBindings("webcore/JSURLSearchParams.cpp") },
    { file: inBindings("webcore/streams/WebStreamsInspectCustom.cpp") },
  ],
  callers: [],
});

const customInspect = "@@@nodejs.util.inspect.custom";

// Stands for the native code behind a call that nothing describes: a native binding without a signature, an overload without a declaration.
const undeclaredNativeCode = "%UndeclaredNativeCode%";

export default b.declarations(
  b.namespace(undeclaredNativeCode, {}, { callsFunctions: warningFunctionsOfUndeclaredCode }),
  ...nativeCalls,
  callsOfInspect,
  Object.entries(loadedModulesByPath).flatMap(([path, loads]) => b.extend(path, { loads })),
  Object.entries(calledFunctionsByPath).flatMap(([path, callsFunctions]) => b.extend(path, { callsFunctions })),
  channelUsers.flatMap(user =>
    typeof user === "string"
      ? b.extend(user, { callsFunctions: channelFunctions })
      : b.extend(user.path, {
          callsFunctions: channelFunctions.map(called => ({ function: called, when: user.when })),
        }),
  ),
  // JSEnvironmentVariableMap.cpp: the object never holds anything but strings, whatever is stored.
  b.hostObject(environmentCell, { otherNames: b.string, keepsStringsOfStoredValues: true }),
  // BunProcess.cpp constructVersions, constructProcessReleaseObject, constructFeatures: ordinary objects. Which versions and features there are differs between platforms and builds.
  b.hostObject(versionsCell, { otherNames: b.string }),
  b.hostObject(releaseCell, { fields: { name: b.string, sourceUrl: b.string, headersUrl: b.string } }),
  b.hostObject(featuresCell, { otherNames: [b.bool, b.string] }),
  // `$asyncContext`: its field holds the frame of AsyncLocalStorage that is current, undefined from the start.
  b.hostObject(asyncContextCell, { prototype: null, internalFields: { 0: [b.inspectedByHost] } }),
  b.hostObject(nextTickQueueCell, {
    prototype: null,
    internalFields: { 2: [b.calledByHost({ times: "Repeatedly", this: b.undefined, args: [], result: b.dropped })] },
  }),
  b.hostFunction(drainMicrotasksCell, "BunProcess.cpp", "jsFunctionDrainMicrotaskQueue", {
    returns: b.undefined,
    capability: "js",
    throws: true,
    implementation: b.hostCall,
  }),
  // Process::emitWarning makes an Error and defines the name, and the code and the detail where it has them.
  b.hostObject(madeWarningsCell, {
    prototype: "Error.prototype",
    fields: {
      name: b.string,
      message: b.string,
      code: b.string.or(b.undefined),
      detail: b.string.or(b.undefined),
      stack: b.nativeMemory,
    },
  }),
  // It reports what the promise of a listener was rejected with, as an exception that nobody has caught.
  b.hostFunction(reportsExceptionCell, "JSEventListener.cpp", "jsFunctionEmitUncaughtException", {
    args: { exception: b.any.optional },
    returns: b.undefined,
    capability: "js",
    throws: true,
    uses: { exception: [b.retained] },
    implementation: b.hostCall,
  }),
  b.hostFunction(
    flushesDirectStreamCell,
    "JSDirectStreamController.cpp",
    "jsWebStreamsHandler_onDirectEndOfTickFlush",
    {
      args: { ignored: b.any.optional, controller: b.any.optional },
      returns: b.any,
      capability: "js",
      throws: true,
      uses: { ignored: b.inspected, controller: [b.retained] },
      implementation: b.hostCall,
    },
  ),
  // It calls what it finds as process.emit, with its own operands.
  b.hostFunction(emitsProcessEventCell, "BunProcess.cpp", "Process_functionEmitHelper", {
    args: { operands: b.any.rest },
    returns: b.any,
    capability: "js",
    throws: true,
    uses: { operands: [b.retained] },
    implementation: b.hostCall,
  }),
  // It emits the event: the listeners of the program get the warning like anything that native code holds.
  b.hostFunction(emitsWarningCell, "BunProcess.cpp", "jsFunction_emitWarning", {
    args: { warning: b.any.optional },
    returns: b.undefined,
    capability: "js",
    throws: true,
    uses: { warning: [b.retained] },
    implementation: b.hostCall,
  }),
  b.hostFunction(throwsWarningCell, "BunProcess.cpp", "jsFunction_throwValue", {
    args: { warning: b.any.optional },
    returns: b.never,
    capability: "heap",
    throws: true,
    uses: { warning: [b.retained] },
    implementation: b.hostCall,
  }),
  // Until the program has read or replaced process.stderr it writes to the descriptor itself.
  b.hostFunction(writeWarningCell, "BunProcess.cpp", "Process_functionWriteWarning", {
    args: { text: b.any.optional },
    returns: b.undefined,
    capability: "js",
    throws: true,
    uses: { text: [b.retained, b.runs("ToPrimitive")] },
    implementation: b.hostCall,
  }),
  b.hostFunction(setModuleWrapperCell, "NodeModuleModule.cpp", "jsFunctionSetCJSWrapperItem", {
    args: { start: b.string.loose, end: b.string.loose },
    returns: b.undefined,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    writes: ["ExternalState"],
    implementation: b.hostCall,
  }),
  b.hostObject(inspectOptionsCell, {
    fields: {
      stylize: [b.nativeCell(stylizeWithColorCell), b.nativeCell(stylizeWithNoColorCell)],
      depth: b.f64,
      colors: b.bool,
    },
  }),
  b.namedMemberCall(customInspect, [b.f64, b.nativeCell(inspectOptionsCell), b.nativeCell(inspectCell)]),
  // ConsoleObject.rs print_to_json and the printer of FormData: the formatter passes nothing.
  b.namedMemberCall("toJSON", []),
  // It prints an object that it makes, or a string, with a copy of the options that it was called with.
  b.hostMethodCall(customInspect, inspectCell, {
    times: "Once",
    this: b.nativeMemory,
    args: [b.nativeMemory, b.nativeMemory],
    result: [b.inspectedByHost],
  }),
  // Below the depth that is printed, the method of URLSearchParams answers what `stylize` of its options answers. The formatter calls the method with its own options.
  [stylizeWithColorCell, stylizeWithNoColorCell].flatMap(cell =>
    b.hostMethodCall(customInspect, cell, {
      times: "Once",
      this: b.nativeCell(inspectOptionsCell),
      args: [b.string, b.string],
    }),
  ),
  b.startup({
    loads: [{ module: "internal/util/inspect", exports: [b.exportRead("inspect", b.keptIn(inspectCell))] }],
    functionsCalledWithLoads: [
      b.functionUsed(
        b.functionIn("builtins/UtilInspect", "getStylizeWithColor"),
        b.calledByHost({
          times: "Once",
          this: b.strictNull,
          args: [b.nativeCell(inspectCell)],
          result: [b.keptIn(stylizeWithColorCell)],
        }),
      ),
      b.functionUsed(b.functionIn("builtins/UtilInspect", "stylizeWithNoColor"), b.keptIn(stylizeWithNoColorCell)),
    ],
    namesOfMethodsCallingLoads: [customInspect],
    moduleLoaderFunctions: functionsIn(
      "builtins/CommonJS",
      "internalRequire",
      "loadEsmIntoCjs",
      "overridableRequire",
      "require",
      "requireESM",
    ),
  }),
  b.excluded("builtins/Bake", "renderRoutesForProdStatic"),
);
