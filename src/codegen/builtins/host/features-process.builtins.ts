import * as b from "bun-builtins-table";
import { pathOfNativeBinding } from "../paths.ts";
import { externalValueFeatures } from "./external-values.ts";

const extendAll = (uses: readonly b.FeatureUseSpec[], ...paths: readonly b.BuiltinPath[]) =>
  paths.flatMap(path => b.extend(path, { usesFeature: uses }));

const nativeBindings = (kind: b.NativeCallKind, file: string, ...symbols: readonly string[]) =>
  symbols.map(symbol => pathOfNativeBinding(kind, file, symbol));

const whenChannelEvent = b.whenOperandOfCallOn("process", "event", "message", "disconnect");
const channelFeatures = ["ProcessIpc", "Ipc", ...externalValueFeatures];

export default b.declarations(
  extendAll(["SourceMaps"], "node:module.SourceMap", "node:module.findSourceMap"),

  extendAll(
    ["PerformanceTimeline"],
    "Performance",
    "PerformanceEntry",
    "PerformanceMeasure",
    "PerformanceObserver",
    "PerformanceObserverEntryList",
    "PerformanceResourceTiming",
    "PerformanceServerTiming",
    "PerformanceTiming",
    "Performance.prototype.clearMarks",
    "Performance.prototype.clearMeasures",
    "Performance.prototype.clearResourceTimings",
    "Performance.prototype.getEntries",
    "Performance.prototype.getEntriesByName",
    "Performance.prototype.getEntriesByType",
    "Performance.prototype.markResourceTiming",
    "Performance.prototype.setResourceTimingBufferSize",
    "Performance.prototype.timing",
    "Performance.prototype.toJSON",
    "node:perf_hooks",
  ),
  extendAll(
    ["PerformanceMarks", "PerformanceTimeline", "StructuredClone"],
    "PerformanceMark",
    "Performance.prototype.mark",
    "Performance.prototype.measure",
  ),
  extendAll(["PerformanceTimeline"], "Performance.prototype.onresourcetimingbufferfull"),

  extendAll(
    ["ProcessReport", "ProcessExecArgv", "ProcessInformation"],
    "process.report",
    "process.report.getReport",
    "process.report.writeReport",
  ),
  extendAll(["ConsoleTable", "StringWidth"], "console.table", "Bun.inspect"),
  extendAll(
    ["ProcessBinding", "HttpParser", "NodeSmallModules", "Buffer", "Float64Array", "BigInt64Array"],
    "process.binding",
  ),
  extendAll(["ProcessExecArgv"], "process.execArgv", ...nativeBindings("Bindgen", "parse_args.bind.ts", "parseArgs")),
  extendAll(
    ["ProcessUsage"],
    "process.availableMemory",
    "process.constrainedMemory",
    "process.cpuUsage",
    "process.memoryUsage",
    "process.resourceUsage",
    "process.threadCpuUsage",
    "process.uptime",
  ),

  extendAll(
    ["Ipc"],
    ...nativeBindings("Bindgen", "ipc_host.bind.ts", "emitHandleIPCMessage"),
    ...nativeBindings("Bindgen", "node_cluster_binding.bind.ts", "sendHelperPrimary"),
    ...nativeBindings(
      "Bindgen",
      "node_cluster_binding.bind.ts",
      "channelIgnoreOneDisconnectEventListener",
      "onInternalMessageChild",
      "onInternalMessagePrimary",
      "setRef",
    ),
    "Bun.spawn",
    "%Subprocess%",
  ),
  extendAll(channelFeatures, "process.channel", "process.disconnect", "process.send"),
  extendAll(["ProcessConnected", "Ipc"], "process.connected"),

  extendAll(
    ["ProcessListeners", ...channelFeatures.map(feature => ({ feature, when: whenChannelEvent }))],
    "%EventEmitter%.prototype.addListener",
    "%EventEmitter%.prototype.on",
    "%EventEmitter%.prototype.once",
    "%EventEmitter%.prototype.prependListener",
    "%EventEmitter%.prototype.prependOnceListener",
  ),
  extendAll(
    ["ProcessListenerRemoval", { feature: "Ipc", when: whenChannelEvent }],
    "%EventEmitter%.prototype.off",
    "%EventEmitter%.prototype.removeAllListeners",
    "%EventEmitter%.prototype.removeListener",
  ),

  extendAll(
    ["ProcessInformation"],
    "process._rawDebug",
    "process.allowedNodeEnvironmentFlags",
    "process.assert",
    "process.config",
    "process.features",
    "process.finalization",
    "process.getBuiltinModule",
    "process.hasUncaughtExceptionCaptureCallback",
    "process.loadEnvFile",
    "process.mainModule",
    "process.ref",
    "process.release",
    "process.revision",
    "process.setSourceMapsEnabled",
    "process.setUncaughtExceptionCaptureCallback",
    "process.unref",
    "process.versions",
  ),
  extendAll(
    ["ProcessControl"],
    "process.chdir",
    "process.getegid",
    "process.geteuid",
    "process.getgid",
    "process.getgroups",
    "process.getuid",
    "process.initgroups",
    "process.setegid",
    "process.seteuid",
    "process.setgid",
    "process.setgroups",
    "process.setuid",
    "process.title",
    "process.umask",
  ),
  extendAll(["ProcessExecve"], "process.execve"),
  extendAll(["ProcessKill"], "process._kill", "process.kill"),

  extendAll(
    ["ProcessOutputStreams", "ProcessStdout"],
    "console._stderr",
    "console._stdout",
    "process.stderr",
    "process.stdout",
  ),
  extendAll(["ProcessStdin"], "process.stdin"),
  extendAll(["ProcessOpenStdin", "ProcessStdin"], "process.openStdin"),
  extendAll(["ConsoleConstructor"], "console.Console"),

  extendAll(["PackageFiles", "HotReload"], "Bun.build"),
  extendAll(["PackageFiles"], "Bun.Transpiler", "Bun.registerMacro"),
);
