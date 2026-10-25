import * as b from "bun-builtins-table";
import {
  argumentsCell,
  environmentCell,
  featuresCell,
  handedWarningsCell,
  releaseCell,
  runtimeArgumentsCell,
  tickShownToHooksCell,
  versionsCell,
} from "./native-cells.ts";
import { handedOver } from "./native-code.ts";

const self = b.operand("this");

const calledWithEvents = b.called({
  afterwards: "TouchesOnlyWhatRowNames",
  times: "PerEvent",
  args: [],
  this: self,
  spreadArgs: b.any,
  result: "Ignored",
});
const calledWithExitCode = b.called({
  afterwards: "TouchesOnlyWhatRowNames",
  times: "Later",
  this: self,
  args: [b.f64],
  result: "Ignored",
});
const calledWithSignal = b.called({
  afterwards: "TouchesOnlyWhatRowNames",
  times: "Later",
  this: b.builtin("globalThis"),
  args: [b.f64, b.f64],
  result: "Escapes",
});
const calledWithUncaughtException = b.called({
  afterwards: "TouchesOnlyWhatRowNames",
  times: "PerEvent",
  this: b.any,
  args: [b.any, b.string],
  result: "Ignored",
});
const calledOnNextTick = b.called({
  afterwards: "TouchesOnlyWhatRowNames",
  times: "Later",
  this: b.undefined,
  args: [],
  spreadArgs: b.operand("passed"),
  result: "Ignored",
});

const listenerLists = ["ExternalState"];
const externalState = ["ExternalState"];

const numberOrString = b.union(b.f64, b.string);
const newArrayOf = (elements: b.TableType) => b.instance("Array").holding({ element: elements }).fresh;

// `process` has no listener methods of its own.
const nativeEmitter = b.union(b.builtin("process"), b.instance("EventEmitter"));

const findsOrMakesEmitter = [
  ...handedOver,
  b.runs(b.named("_events")),
  b.definesName(["_events"], b.instance("EventEmitter").fresh),
];

const onOtherReceiver = (firstParameter: string): b.FunctionField => ({
  this: b.any,
  args: { [firstParameter]: b.any.optional, operands: b.any.rest },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: {
    this: findsOrMakesEmitter,
    [firstParameter]: [...handedOver, b.runsTransitively("ToPrimitive")],
    operands: handedOver,
  },
  implementation: b.generic,
});

const methodOfEventEmitter = (signature: b.SignatureOptions): b.FunctionField[] => [
  { ...signature, this: nativeEmitter, implementation: b.generic },
  onOtherReceiver(Object.keys(signature.args ?? {})[0] ?? "event"),
];

const addsListener = methodOfEventEmitter({
  args: { event: b.any, listener: b.any },
  returns: self,
  capability: "js",
  throws: true,
  uses: {
    this: b.inspected,
    event: [b.retained, b.runs("ToPrimitive")],
    listener: [b.retained, calledWithEvents],
  },
});

const removesListener = methodOfEventEmitter({
  args: { event: b.propertyKey.loose, listener: b.any.optional },
  returns: self,
  capability: "heap",
  throws: true,
  uses: { this: b.inspected, listener: b.inspected },
  reads: listenerLists,
  writes: listenerLists,
});

const removesAllListeners = methodOfEventEmitter({
  args: { event: b.propertyKey.loose.optional },
  returns: self,
  capability: "heap",
  throws: true,
  uses: { this: b.inspected },
  writes: listenerLists,
});

const setsMaxListeners = methodOfEventEmitter({
  args: { count: b.union(b.f64, b.notPassed) },
  returns: b.undefined,
  capability: "heap",
  throws: true,
  uses: { this: b.inspected },
  writes: listenerLists,
});

const readsListenerLists = (signature: Pick<b.SignatureOptions, "args" | "returns">) =>
  methodOfEventEmitter({
    ...signature,
    capability: "heap",
    throws: true,
    uses: { this: b.inspected },
    reads: listenerLists,
  });

const listsListeners = readsListenerLists({ args: { event: b.propertyKey.loose }, returns: newArrayOf(b.any) });

// It calls the listeners that were added under the event, each with the values and with the object that a listener was last added through as `this`.
const emitsEvent = {
  this: b.any,
  args: { event: b.any, values: b.any.rest },
  returns: b.bool,
  capability: "js",
  throws: true,
  uses: { this: findsOrMakesEmitter, event: [b.retained, b.runsTransitively("ToPrimitive")], values: handedOver },
  implementation: b.generic,
} satisfies b.FunctionField;

const replaceableFunction = (callback: b.UseSpec, call: b.FunctionField) =>
  b.property(b.callable, {
    setter: {
      this: b.object,
      value: b.any,
      capability: "heap",
      uses: { this: b.inspected, value: [b.retained, callback] },
      writes: ["ShapeWords", "NamedProperties"],
      implementation: b.generic,
    },
    call,
  });

// constructStdioWriteStream() in BunProcess.cpp: where the code that makes the stream throws, as it does when the stack is full, it reports the error and the property is undefined from then on.
const outputStream = b.property(b.union(b.object, b.undefined), {
  createdOnFirstRead: { capability: "js", throws: true },
  setter: {
    this: b.object,
    value: b.any,
    capability: "heap",
    uses: { this: b.inspected, value: [b.retained] },
    writes: ["ShapeWords", "NamedProperties"],
    implementation: b.generic,
  },
});

// The message of an error about a refused value reads its constructor.name, or prints it the way console.log does.
const formattedAfterReading = (...members: readonly string[]) => b.printedByFormatter("constructor", ...members);
const formattedInErrorMessage = formattedAfterReading();

const refusal = (operands: readonly string[], implementation: b.ImplementationSpec = b.hostCall) =>
  ({
    args: Object.fromEntries(operands.map(name => [name, b.any.optional])),
    returns: b.never,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: Object.fromEntries(operands.map(name => [name, [formattedInErrorMessage]])),
    implementation,
  }) satisfies b.FunctionField;

const endsProcessUnlessInWorker = (code: readonly b.UseSpec[]) =>
  ({
    args: { code: b.any.optional },
    returns: b.undefined,
    capability: "js",
    throws: true,
    uses: { code },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const doesNothing = { capability: "none", implementation: b.hostCall } satisfies b.FunctionField;

const createsEmptyArray = {
  returns: newArrayOf(b.never),
  capability: "heap",
  implementation: b.hostCall,
} satisfies b.FunctionField;

const measuresNumber = {
  returns: b.f64,
  capability: "none",
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} satisfies b.FunctionField;

const systemCall = {
  capability: "heap",
  throws: true,
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} as const;

const changesId = [
  { ...systemCall, args: { id: numberOrString }, returns: b.f64 },
  refusal(["id"]),
] satisfies b.FunctionField[];

const usageRecord = { ...systemCall, returns: b.object.fresh, uses: { this: b.inspected } } satisfies b.FunctionField;

const usageSincePrevious = [
  { ...usageRecord, args: { previous: b.undefined.optional } },
  {
    ...usageRecord,
    args: { previous: b.any },
    capability: "js",
    runsOnlyOperandCode: true,
    uses: { this: b.inspected, previous: [formattedAfterReading("user", "system")] },
  },
] satisfies b.FunctionField[];

const highResolutionTime = {
  ...systemCall,
  returns: newArrayOf(b.f64),
  implementation: b.generic,
} satisfies b.FunctionField;

const highResolutionTimeSince = [
  { ...highResolutionTime, args: { time: b.undefined.optional } },
  {
    ...highResolutionTime,
    args: { time: b.instance("Array").holding({ element: b.f64 }).pristine("Storage") },
    uses: { time: [b.readsContents()] },
  },
  {
    ...highResolutionTime,
    args: { time: b.any },
    capability: "js",
    runsOnlyOperandCode: true,
    uses: { time: [b.readsContents(), formattedInErrorMessage] },
  },
] satisfies b.FunctionField[];

// While an init hook of node:async_hooks is enabled, the callback and its arguments go to the function of the library that shows them to the hooks. node:async_hooks hands that function over with the first hook.
const shownToInitHooks = b.keptCalled(tickShownToHooksCell, {
  times: "Once",
  this: b.undefined,
  args: [b.operand("callback"), newArrayOf(b.operand("passed")).or(b.undefined), b.nativeMemory],
  result: "Ignored",
});

const queuesTick = [
  {
    args: { callback: b.callable, passed: b.any.rest },
    capability: "js",
    throws: true,
    uses: { callback: [calledOnNextTick, shownToInitHooks], passed: b.inspected },
    implementation: b.generic,
  },
  refusal(["callback"], b.generic),
] satisfies b.FunctionField[];

const warningOptions = { type: b.any.optional, code: b.any.optional };
const warningOptionUses = {
  type: [formattedAfterReading("ctor", "code", "detail", "type")],
  code: [formattedInErrorMessage],
};

const emitsWarningOnNextTick = [
  {
    args: { warning: b.string, ...warningOptions },
    capability: "js",
    throws: true,
    uses: warningOptionUses,
    implementation: b.hostCall,
  },
  {
    args: { warning: b.any.optional, ...warningOptions },
    capability: "js",
    throws: true,
    uses: {
      warning: [
        b.retained,
        b.storedIn(b.nativeCell(handedWarningsCell)),
        b.definesName(["code", "detail"], b.string),
        formattedInErrorMessage,
      ],
      ...warningOptionUses,
    },
    implementation: b.hostCall,
  },
] satisfies b.FunctionField[];

const callsMemberOfOperand = (...members: readonly string[]) =>
  ({
    args: { target: b.any.optional },
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { target: [b.runs(b.calls(...members))] },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const nativeState = (getter: b.TableType, setter: b.SetterOptions) =>
  ({
    getter,
    capability: "heap",
    throws: true,
    reads: externalState,
    implementation: b.generic,
    setter: { ...setter, implementation: b.generic },
  }) satisfies b.GetterField;

const ignoresValue = {
  value: b.any,
  capability: "heap",
  throws: true,
  uses: { value: b.inspected },
} satisfies b.SetterOptions;

// Native code makes the list of strings at the first read. From then on it is a property like any other.
const listOfStringsKeptIn = (cell: string) =>
  b.property(b.any, {
    createdOnFirstRead: {
      capability: "heap",
      throws: true,
      uses: { this: [b.createdIn(newArrayOf(b.string), b.nativeCell(cell)), b.returnedFrom(cell)] },
      reads: externalState,
    },
  });

const createdOnFirstRead = (holds: b.TableType) => b.property(holds, { createdOnFirstRead: { capability: "heap" } });
// One of the objects that runtime-dependencies.builtins.ts describes.
const objectCreatedOnFirstRead = (cell: string) =>
  b.property(b.object, { createdOnFirstRead: { capability: "heap", uses: { this: [b.returnedFrom(cell)] } } });

const declareEach = <Declared extends b.Field>(names: readonly string[], field: Declared) =>
  Object.fromEntries(names.map(name => [name, field]));

// Each is there, holds true and is read-only in a run that was started with the flag of its name.
const setByCommandLineFlag = [
  "noDeprecation",
  "noProcessWarnings",
  "pendingDeprecation",
  "throwDeprecation",
  "traceDeprecation",
  "traceProcessWarnings",
];

const functionsDoingNothing = ["_linkedBinding", "_tickCallback"];
const functionsCreatingEmptyArray = ["_getActiveHandles", "_getActiveRequests", "getActiveResourcesInfo"];
const functionsMeasuringNumber = [
  "availableMemory",
  "constrainedMemory",
  "getegid",
  "geteuid",
  "getgid",
  "getuid",
  "uptime",
];
const functionsChangingId = ["setegid", "seteuid", "setgid", "setuid"];
const functionsMeasuringUsageSincePrevious = ["cpuUsage", "threadCpuUsage"];
const stringsCreatedOnFirstRead = ["argv0", "execPath", "revision", "version"];

const changedByNativeCode = ["channel", "connected", "exitCode", "ppid"];

const computedOnce = [
  "_kill",
  "arch",
  "argv",
  "argv0",
  "browser",
  "config",
  "env",
  "execArgv",
  "execPath",
  "features",
  "hrtime",
  "memoryUsage",
  "nextTick",
  "pid",
  "platform",
  "reallyExit",
  "revision",
  "stderr",
  "stdin",
  "stdout",
  "version",
];

// Programs read these to find out which runtime they are on. The compiler folds those reads (src/aot/load/locked_builtin_defines.rs), so they are locked.
const runtimeIdentity = ["isBun", "release", "versions"];

// Every `get` and `getIfPropertyExists` on the object in BunProcess.cpp and ZigGlobalObject.cpp.
const lookedUpByNativeCode = [
  "_fatalException",
  "_kill",
  "argv",
  "emit",
  "execArgv",
  "nextTick",
  "noDeprecation",
  "reallyExit",
  "stderr",
  "stdin",
  "stdout",
  "throwDeprecation",
];
// It asks whether _fatalException can be called, and whether each of the other two is true.
const onlyInspectedByNativeCode = ["_fatalException", "noDeprecation", "throwDeprecation"];

export default b.declarations(
  b.namespace(
    "process",
    {
      _exiting: b.property(b.bool, { mutability: "ChangesOnItsOwn" }),
      ...declareEach(setByCommandLineFlag, b.property(b.union(b.bool, b.undefined), { mutability: "ChangesOnItsOwn" })),
      exit: endsProcessUnlessInWorker([formattedInErrorMessage]),
      reallyExit: replaceableFunction(calledWithExitCode, endsProcessUnlessInWorker(b.inspected)),
      abort: {
        returns: b.never,
        capability: "none",
        writes: ["ExternalState"],
        implementation: b.hostCall,
      },
      kill: {
        args: { pid: b.any, signal: b.any.optional },
        returns: b.bool,
        capability: "js",
        throws: true,
        uses: { pid: [b.runs("ToPrimitive"), formattedInErrorMessage], signal: [formattedInErrorMessage] },
        implementation: b.hostCall,
      },
      _kill: replaceableFunction(calledWithSignal, b.otherwise),
      stderr: outputStream,
      stdout: outputStream,
      pid: createdOnFirstRead(b.f64),
      browser: createdOnFirstRead(b.bool),
      isBun: createdOnFirstRead(b.bool),
      features: objectCreatedOnFirstRead(featuresCell),
      release: objectCreatedOnFirstRead(releaseCell),
      versions: objectCreatedOnFirstRead(versionsCell),
      // The object that runtime-dependencies.builtins.ts describes.
      env: b.property(b.object, {
        createdOnFirstRead: { capability: "heap", throws: true, uses: { this: [b.returnedFrom(environmentCell)] } },
      }),
      ...declareEach(stringsCreatedOnFirstRead, createdOnFirstRead(b.string)),
      // constructArch and constructPlatform in BunProcess.cpp. A program may store to either, so neither is locked.
      arch: b.constantString({ ARM64: "arm64", X86_64: "x64" }),
      platform: b.constantString({
        Darwin: "darwin",
        Linux: "linux",
        Windows: "win32",
        FreeBSD: "freebsd",
        Android: "android",
      }),

      _eval: nativeState(b.union(b.string, b.undefined), ignoresValue),
      argv: listOfStringsKeptIn(argumentsCell),
      connected: nativeState(b.union(b.bool, b.undefined), ignoresValue),
      debugPort: nativeState(b.f64, {
        value: b.f64.loose,
        capability: "heap",
        throws: true,
        writes: externalState,
      }),
      execArgv: listOfStringsKeptIn(runtimeArgumentsCell),
      exitCode: nativeState(b.union(b.f64, b.undefined), {
        value: b.any,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: { value: [formattedInErrorMessage] },
        writes: externalState,
      }),
      // setProcessPpid defines a data property on whatever it is called on: a proxy runs its trap, a frozen object refuses.
      ppid: nativeState(b.any, {
        value: b.any,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: { this: [b.definesName(["ppid"], b.operand("value")), ...b.ownPropertyTraps], value: [b.retained] },
      }),
      title: nativeState(b.string, {
        value: b.any,
        capability: "heap",
        throws: true,
        uses: { value: b.inspected },
        writes: externalState,
      }),

      ...declareEach(functionsDoingNothing, doesNothing),
      ...declareEach(functionsCreatingEmptyArray, createsEmptyArray),
      ...declareEach(functionsMeasuringNumber, measuresNumber),
      ...declareEach(functionsChangingId, changesId),
      ...declareEach(functionsMeasuringUsageSincePrevious, usageSincePrevious),
      resourceUsage: usageRecord,
      memoryUsage: { ...usageRecord, implementation: b.generic },
      hrtime: highResolutionTimeSince,
      nextTick: queuesTick,
      emitWarning: emitsWarningOnNextTick,
      ref: callsMemberOfOperand("@@@nodejs.ref", "ref"),
      unref: callsMemberOfOperand("@@@nodejs.unref", "unref"),
      cwd: { ...systemCall, returns: b.string },
      chdir: [{ ...systemCall, args: { directory: b.string }, returns: b.string }, refusal(["directory"])],
      umask: [{ ...systemCall, args: { mask: numberOrString.optional }, returns: b.f64 }, refusal(["mask"])],
      getgroups: { ...systemCall, returns: newArrayOf(b.f64) },
      setgroups: {
        ...systemCall,
        args: { groups: b.any.optional },
        returns: b.f64,
        capability: "js",
        runsOnlyOperandCode: true,
        uses: { groups: [b.readsContents(), formattedInErrorMessage] },
      },
      initgroups: [
        { ...systemCall, args: { user: numberOrString, extraGroup: numberOrString } },
        refusal(["user", "extraGroup"]),
      ],
      execve: {
        args: { execPath: b.any.optional, argv: b.any.optional, env: b.any.optional },
        returns: b.never,
        capability: "js",
        throws: true,
        uses: {
          execPath: [formattedInErrorMessage],
          argv: [formattedInErrorMessage],
          env: [formattedInErrorMessage],
        },
        implementation: b.hostCall,
      },
      dlopen: {
        args: { module: b.any.optional, filename: b.any.optional },
        returns: b.any,
        capability: "js",
        throws: true,
        uses: { module: [b.everything], filename: [b.runs("ToPrimitive")] },
        implementation: b.hostCall,
      },
      binding: {
        args: { name: b.any.optional },
        returns: b.object,
        capability: "js",
        throws: true,
        uses: { name: [b.runs("ToPrimitive")] },
        implementation: b.hostCall,
      },
      assert: {
        args: { condition: b.any.optional, message: b.any.optional },
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: { condition: b.inspected, message: [b.runs("ToPrimitive")] },
        implementation: b.hostCall,
      },
      openStdin: { returns: b.any, capability: "js", throws: true, implementation: b.hostCall },
      setSourceMapsEnabled: [
        { args: { enabled: b.bool }, capability: "none", writes: externalState, implementation: b.hostCall },
        refusal(["enabled"]),
      ],
      setUncaughtExceptionCaptureCallback: [
        {
          ...systemCall,
          args: { callback: b.union(b.callable, b.strictNull) },
          uses: { callback: [b.retained, calledWithUncaughtException] },
        },
        refusal(["callback"]),
      ],
      hasUncaughtExceptionCaptureCallback: {
        returns: b.bool,
        capability: "none",
        reads: externalState,
        implementation: b.hostCall,
      },
      _fatalException: {
        args: { error: b.any.optional, fromPromise: b.any.optional },
        returns: b.bool,
        capability: "js",
        throws: true,
        uses: { error: [b.retained], fromPromise: b.inspected },
        implementation: b.hostCall,
      },
      _rawDebug: {
        args: { values: b.any.rest },
        capability: "js",
        throws: true,
        uses: { values: [b.everything] },
        implementation: b.generic,
      },
      loadEnvFile: {
        args: { path: b.any.optional },
        capability: "js",
        throws: true,
        uses: { path: [formattedInErrorMessage] },
        implementation: b.generic,
      },
    },
    {
      table: b.staticTable("src/jsc/bindings/BunProcess.cpp", "processObjectTable"),
      namesReadByNativeCode: lookedUpByNativeCode,
      namesOnlyInspectedByNativeCode: onlyInspectedByNativeCode,
    },
  ),
  b.namespace("process.report", {
    getReport: { returns: b.object, capability: "js", throws: true, implementation: b.generic },
    writeReport: {
      args: { fileName: b.any.optional },
      returns: b.union(b.operand("fileName"), b.undefined),
      capability: "none",
      uses: { fileName: b.inspected },
      implementation: b.generic,
    },
  }),
  b.class("%EventEmitter%", {
    instanceCppClass: b.cppClass("WebCore::JSEventEmitter", "JSEventEmitter.h"),
    prototypeCppExpression: "WebCore::JSEventEmitter::prototype(globalObject->vm(), *globalObject)",
    instanceStructureCppExpression: "globalObject->domStructure(WebCore::DOMStructureSlot::JSEventEmitter)",
    hasConstructor: false,
    instancesAreEntries: true,
    proto: {
      on: addsListener,
      once: addsListener,
      addListener: addsListener,
      prependListener: addsListener,
      prependOnceListener: addsListener,
      off: removesListener,
      removeListener: removesListener,
      removeAllListeners: removesAllListeners,
      setMaxListeners: setsMaxListeners,
      // Native code looks `emit` up on process for each event, so it calls what a program has stored there.
      emit: replaceableFunction(calledWithEvents, emitsEvent),
      eventNames: readsListenerLists({ returns: newArrayOf(b.union(b.string, b.symbol)) }),
      getMaxListeners: readsListenerLists({ returns: b.f64 }),
      listenerCount: readsListenerLists({ args: { event: b.propertyKey.loose }, returns: b.f64 }),
      listeners: listsListeners,
      rawListeners: listsListeners,
    },
  }),
  b.inherits("process", "%EventEmitter%.prototype"),
  b.inherits("process.report", "Object.prototype"),
  changedByNativeCode.flatMap(name => b.extend(`process.${name}`, { mutability: "ChangesOnItsOwn" })),
  computedOnce.flatMap(name => b.extend(`process.${name}`, { mutability: "ConstantUnlessWritten" })),
  runtimeIdentity.flatMap(name => b.extend(`process.${name}`, { mutability: "AlwaysLocked" })),
  b.extend("process", { mutability: "AlwaysLocked" }),
);
