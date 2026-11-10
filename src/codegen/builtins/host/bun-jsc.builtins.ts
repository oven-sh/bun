// The functions of bun:jsc, each from its code in src/jsc/modules/BunJSCModule.h. collect-modules.ts finds that they are functions.
// codeCoverageForFile, getProtectedObjects and profile have no row: a call of one is a call of native code of which nothing is written down.
import * as b from "bun-builtins-table";
import { cloned, heapsReadByClone, heapsWrittenByClone } from "./native-code.ts";

const externalState = ["ExternalState"];
const parsedJSON = b.union(b.plainData, b.strictNull, b.bool, b.f64, b.string);

const readsCounter = (returns: b.TableType) =>
  ({
    returns,
    capability: "heap",
    reads: externalState,
    implementation: b.generic,
  }) satisfies b.FunctionField;

const collects = {
  returns: b.f64,
  capability: "heap",
  reads: externalState,
  writes: externalState,
  implementation: b.generic,
} satisfies b.FunctionField;

// It looks at the cell of its operand, or at the code behind a function, and calls nothing.
const looksAt = (returns: b.TableType) =>
  ({
    args: { value: b.any.optional },
    returns,
    capability: "heap",
    uses: { value: b.inspected },
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  }) satisfies b.FunctionField;

const parsesReport = {
  returns: parsedJSON,
  capability: "heap",
  throws: true,
  reads: externalState,
  writes: externalState,
  implementation: b.generic,
} satisfies b.FunctionField;

// What is no string is refused as it is. Every Date answers by the new zone from here on.
const setsTimeZone = {
  args: { zone: b.any.optional },
  returns: b.string,
  capability: "js",
  throws: true,
  uses: { zone: b.inspected },
  implementation: b.generic,
} satisfies b.FunctionField;

const describes = looksAt(b.union(b.string, b.undefined));
const countsForFunction = looksAt(b.union(b.f64, b.undefined));
const marksFunction = looksAt(b.undefined);

const functions = {
  bytecodeOrderStats: readsCounter(b.union(b.plainData.fresh, b.strictNull)),
  callerSourceOrigin: readsCounter(b.union(b.string, b.strictNull)),
  describe: describes,
  describeArray: describes,
  deserialize: {
    args: { bytes: b.any.optional },
    returns: b.any.fresh,
    capability: "heap",
    throws: true,
    uses: { bytes: [b.readsContents()] },
    reads: ["TypedArrayStorage", "TypedArrayElements", ...externalState],
    writes: ["TypedArrayStorage", ...externalState],
    implementation: b.generic,
  },
  drainMicrotasks: { returns: b.undefined, capability: "js", throws: true, implementation: b.generic },
  edenGC: collects,
  estimateShallowMemoryUsageOf: looksAt(b.f64),
  fullGC: collects,
  gcAndSweep: collects,
  generateHeapSnapshotForDebugging: parsesReport,
  getRandomSeed: { ...readsCounter(b.f64), reads: ["RuntimeState", ...externalState] },
  heapSize: readsCounter(b.f64),
  heapStats: {
    args: { options: b.any.optional },
    returns: b.plainData.fresh,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { options: b.optionBag(["dump"]) },
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  },
  isRope: looksAt(b.bool),
  jscDescribe: describes,
  jscDescribeArray: describes,
  memoryUsage: readsCounter(b.plainData.fresh),
  noFTL: marksFunction,
  noInline: marksFunction,
  noOSRExitFuzzing: marksFunction,
  numberOfDFGCompiles: countsForFunction,
  optimizeNextInvocation: marksFunction,
  percentAvailableMemoryInUse: readsCounter(b.strictNull),
  releaseWeakRefs: { ...collects, returns: b.undefined },
  reoptimizationRetryCount: countsForFunction,
  samplingProfilerStackTraces: parsesReport,
  serialize: {
    args: { value: b.any.optional, options: b.any.optional },
    returns: b.union(b.instance("Buffer"), b.instance("ArrayBuffer"), b.instance("SharedArrayBuffer")).fresh,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { value: cloned, options: b.optionBag(["binaryType"]) },
    reads: heapsReadByClone,
    writes: heapsWrittenByClone,
    implementation: b.generic,
  },
  setRandomSeed: {
    args: { seed: b.any.optional },
    returns: b.undefined,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { seed: [b.runs("ToPrimitive")] },
    reads: ["RuntimeState", ...externalState],
    writes: ["RuntimeState", ...externalState],
    implementation: b.generic,
  },
  setTimeZone: setsTimeZone,
  setTimezone: setsTimeZone,
  startRemoteDebugger: {
    args: { host: b.any.optional, port: b.any.optional },
    returns: b.undefined,
    capability: "heap",
    throws: true,
    uses: { host: b.inspected, port: b.inspected },
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  },
  startSamplingProfiler: {
    args: { directory: b.any.optional, interval: b.any.optional },
    returns: b.undefined,
    capability: "heap",
    throws: true,
    uses: { directory: b.inspected, interval: b.inspected },
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  },
  totalCompileTime: readsCounter(b.f64),
} satisfies Record<string, b.FunctionField>;

export default b.declarations(Object.entries(functions).flatMap(([name, row]) => b.fn(`bun:jsc.${name}`, row)));
