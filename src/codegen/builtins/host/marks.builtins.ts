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
  marked("HoldsLoader", [
    "%ModuleRequire%.cache",
    "node:module._cache",
    "%ModuleObject%.require",
    "node:module.prototype.require",
    "node:module.wrap",
    "node:module._load",
    "node:module._resolveFilename",
  ]),
  marked("IsSpy", ["bun:test.spyOn", "bun:test.jest.spyOn", "bun:test.vi.spyOn"]),
  marked("IsNotEnumerable", ["console._stdout", "console._stderr"]),
  marked("IsReplacedBySetter", ["self"]),
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
  marked("RunsWaitingJobs", ["%Expect%", "Bun.jest", "HTMLRewriter", "bun:jsc.drainMicrotasks", "bun:test"]),

  b.extend("process.dlopen", { loadsMachineCodeAs: "process.dlopen" }),
  b.extend("%NativeFunctions%.FfiBindTsCc", { loadsMachineCodeAs: "bun:ffi.cc" }),
  b.extend("Bun.FFI.dlopen", { loadsMachineCodeAs: "bun:ffi.dlopen" }),
  b.extend("Bun.FFI.linkSymbols", { loadsMachineCodeAs: "bun:ffi.linkSymbols" }),
  b.extend("Bun.FFI.cfunction", { loadsMachineCodeAs: "bun:ffi.CFunction" }),
  b.extend("%NativeFunctions%.FfiBindTsOpenLibrary", { loadsMachineCodeAs: "bun:ffi.dlopen" }),
  b.extend("%NativeFunctions%.FfiBindTsLinkLibrary", { loadsMachineCodeAs: "bun:ffi.linkSymbols" }),
  b.extend("%NativeFunctions%.FfiBindTsMakeFunction", { loadsMachineCodeAs: "bun:ffi.CFunction" }),
);
