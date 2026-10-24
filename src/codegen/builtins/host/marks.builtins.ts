import * as b from "bun-builtins-table";

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
    "Bun.Transpiler",
  ]),
  marked("HoldsLoader", [
    "%ModuleRequire%.cache",
    "node:module._cache",
    "%ModuleObject%.require",
    "node:module.prototype.require",
    "node:module.wrap",
    "node:module.wrapper",
    "node:module._load",
    "node:module._resolveFilename",
  ]),
  marked("IsSpy", ["bun:test.spyOn", "bun:test.jest.spyOn", "bun:test.vi.spyOn"]),
  marked("IsNotEnumerable", ["console._stdout", "console._stderr"]),

  b.extend("process.dlopen", { loadsMachineCodeAs: "process.dlopen" }),
  b.extend("%NativeFunctions%.FfiBindTsCc", { loadsMachineCodeAs: "bun:ffi.cc" }),
  b.extend("Bun.FFI.dlopen", { loadsMachineCodeAs: "bun:ffi.dlopen" }),
  b.extend("Bun.FFI.linkSymbols", { loadsMachineCodeAs: "bun:ffi.linkSymbols" }),
  b.extend("Bun.FFI.cfunction", { loadsMachineCodeAs: "bun:ffi.CFunction" }),
);
