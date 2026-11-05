import * as b from "bun-builtins-table";
import { classesWithInspectMethod } from "./classes-with-inspect-method.ts";

const marked = (mark: b.BuiltinMark, paths: readonly b.BuiltinPath[]) =>
  paths.flatMap(path => b.extend(path, { marks: [mark] }));

export default b.declarations(
  marked("IsAddedByOption", [
    "$vm",
    "Loader",
    "__disableSamplingProfiler",
    "__disableSuperSampler",
    "__dumpAndClearSamplingProfilerSamples",
    "__enableSamplingProfiler",
    "__enableSuperSampler",
    "__signpostStart",
    "__signpostStop",
    "__tracePointStart",
    "__tracePointStop",
    "gc",
    "process.noDeprecation",
    "process.noProcessWarnings",
    "process.pendingDeprecation",
    "process.throwDeprecation",
    "process.traceDeprecation",
    "process.traceProcessWarnings",
  ]),
  marked("EvaluatesTextInGlobalScope", [
    "%NodeVMBinding%.Script",
    "%NodeVMBinding%.Module",
    "%NodeVMBinding%.compileFunction",
  ]),
  // `app` names an application on disk, which the dev server bundles and runs as scripts of this realm: BakeLoadInitialServerCode() and BakeLoadServerHmrPatch() in src/runtime/bake/BakeSourceProvider.cpp.
  // It gets past no lock. It is the program and no guest of it, and a program replaces what it likes: where the build sees the option it lays no lock of its own.
  marked("RunsCodeThatLocksDoNotBind", ["Bun.serve"]),
  // The loader asks what is registered with it first, under every name that the build has not followed, and answers with the module that the plugin makes.
  marked("RunsCodeWithLoader", ["Bun.plugin"]),
  // functionGetProtectedObjects() in src/jsc/modules/BunJSCModule.h: every protected cell and every strong root that is an object.
  marked("HandsOutWhatNativeCodeHolds", ["bun:jsc.getProtectedObjects"]),
  marked("HoldsLoader", [
    "%ModuleRequire%.cache",
    "%ModuleRequirePrototype%.cache",
    "node:module._cache",
    "%ModuleObject%.require",
    "node:module.prototype.require",
    "node:module.wrap",
    "node:module._load",
    "node:module._resolveFilename",
  ]),
  marked("AnswersWithPathOfModule", [
    "%ImportMeta%.resolve",
    "%ImportMeta%.resolveSync",
    "%ModuleRequire%.resolve",
    "%ModuleRequirePrototype%.resolve",
    "Bun.resolve",
    "Bun.resolveSync",
  ]),
  // import() of a graph, and the handlers under ".js" and the like: (module, filename) => ..
  marked("ReadLoadsCodeByName", [
    "Bun.ModuleGraph",
    "%ModuleRequire%.extensions",
    "%ModuleRequirePrototype%.extensions",
    "node:module._extensions",
  ]),
  marked("IsResolverThatLoaderCalls", ["node:module._resolveFilename"]),
  marked("IsRequireThatLoaderCalls", ["node:module.prototype.require"]),
  marked("IsSpy", [
    "bun:test.spyOn",
    "bun:test.jest.spyOn",
    "bun:test.vi.spyOn",
    "bun:test/vitest.spyOn",
    "bun:test/vitest.vi.spyOn",
  ]),
  marked("MocksModule", [
    "bun:test.mock.module",
    "bun:test.jest.mock",
    "bun:test.jest.doMock",
    "bun:test.vi.mock",
    "bun:test.vi.doMock",
  ]),
  marked("ExtendsMatchers", ["%Expect%.extend"]),
  marked("FakesTimers", [
    "bun:test.jest.useFakeTimers",
    "bun:test.vi.useFakeTimers",
    "bun:test/vitest.vi.useFakeTimers",
  ]),
  // What FakeTimers::fakes() in src/runtime/test_runner/timers/FakeTimers.rs makes a fake for. The native Date.now and performance.now stay where they are: the clock is faked below them.
  marked("IsReplacedByFakeTimers", [
    "clearImmediate",
    "clearInterval",
    "clearTimeout",
    "performance",
    "process.nextTick",
    "queueMicrotask",
    "setImmediate",
    "setInterval",
    "setTimeout",
  ]),
  marked("HoldsPathOfMainModule", ["Bun.main"]),
  // JSEnvironmentVariableMap.cpp puts another object under both when the thread starts a worker with `env: SHARE_ENV`.
  marked("IsReplacedByHostThatSaysSo", ["Bun.env", "process.env"]),
  marked("IsCalledWithoutStartupLoads", ["Buffer.prototype.inspect"]),
  marked("InstancesHaveMethodCalledWithStartupLoads", classesWithInspectMethod),
  // These reject napi_env and napi_value in a signature (reject_napi_types_error in ffi_body.rs). Only cc() accepts them.
  marked("LoadsCodeWithoutJSAccess", [
    "%NativeFunctions%.FfiBindTsLinkLibrary",
    "%NativeFunctions%.FfiBindTsMakeFunction",
    "%NativeFunctions%.FfiBindTsOpenLibrary",
    "Bun.FFI.cfunction",
    "Bun.FFI.dlopen",
    "Bun.FFI.linkSymbols",
  ]),
  marked("MayTerminateProcess", [
    "process._kill",
    "process.abort",
    "process.execve",
    "process.exit",
    "process.kill",
    "process.reallyExit",
  ]),
  marked("RunsWaitingJobs", [
    "%Expect%",
    "Bun.jest",
    "HTMLRewriter",
    "bun:jsc.drainMicrotasks",
    "bun:test",
    "bun:test/vitest",
  ]),

  b.extend("process.dlopen", { loadsMachineCodeAs: "process.dlopen" }),
  b.extend("%NativeFunctions%.FfiBindTsCc", { loadsMachineCodeAs: "bun:ffi.cc" }),
  b.extend("Bun.FFI.dlopen", { loadsMachineCodeAs: "bun:ffi.dlopen" }),
  b.extend("Bun.FFI.linkSymbols", { loadsMachineCodeAs: "bun:ffi.linkSymbols" }),
  b.extend("Bun.FFI.cfunction", { loadsMachineCodeAs: "bun:ffi.CFunction" }),
  b.extend("%NativeFunctions%.FfiBindTsOpenLibrary", { loadsMachineCodeAs: "bun:ffi.dlopen" }),
  b.extend("%NativeFunctions%.FfiBindTsLinkLibrary", { loadsMachineCodeAs: "bun:ffi.linkSymbols" }),
  b.extend("%NativeFunctions%.FfiBindTsMakeFunction", { loadsMachineCodeAs: "bun:ffi.CFunction" }),
);
