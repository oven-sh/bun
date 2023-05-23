// src/js/bun/jsc.js
var jsc = globalThis[Symbol.for("Bun.lazy")]("bun:jsc");
var callerSourceOrigin = jsc.callerSourceOrigin;
var jscDescribe = jsc.describe;
var jscDescribeArray = jsc.describeArray;
var describe = jscDescribe;
var describeArray = jscDescribeArray;
var drainMicrotasks = jsc.drainMicrotasks;
var edenGC = jsc.edenGC;
var fullGC = jsc.fullGC;
var gcAndSweep = jsc.gcAndSweep;
var getRandomSeed = jsc.getRandomSeed;
var heapSize = jsc.heapSize;
var heapStats = jsc.heapStats;
var startSamplingProfiler = jsc.startSamplingProfiler;
var samplingProfilerStackTraces = jsc.samplingProfilerStackTraces;
var isRope = jsc.isRope;
var memoryUsage = jsc.memoryUsage;
var noInline = jsc.noInline;
var noFTL = jsc.noFTL;
var noOSRExitFuzzing = jsc.noOSRExitFuzzing;
var numberOfDFGCompiles = jsc.numberOfDFGCompiles;
var optimizeNextInvocation = jsc.optimizeNextInvocation;
var releaseWeakRefs = jsc.releaseWeakRefs;
var reoptimizationRetryCount = jsc.reoptimizationRetryCount;
var setRandomSeed = jsc.setRandomSeed;
var startRemoteDebugger = jsc.startRemoteDebugger;
var totalCompileTime = jsc.totalCompileTime;
var getProtectedObjects = jsc.getProtectedObjects;
var generateHeapSnapshotForDebugging = jsc.generateHeapSnapshotForDebugging;
var profile = jsc.profile;
var jsc_default = jsc;
var setTimeZone = jsc.setTimeZone;
var setTimezone = setTimeZone;
export {
  totalCompileTime,
  startSamplingProfiler,
  startRemoteDebugger,
  setTimezone,
  setTimeZone,
  setRandomSeed,
  samplingProfilerStackTraces,
  reoptimizationRetryCount,
  releaseWeakRefs,
  profile,
  optimizeNextInvocation,
  numberOfDFGCompiles,
  noOSRExitFuzzing,
  noInline,
  noFTL,
  memoryUsage,
  jscDescribeArray,
  jscDescribe,
  isRope,
  heapStats,
  heapSize,
  getRandomSeed,
  getProtectedObjects,
  generateHeapSnapshotForDebugging,
  gcAndSweep,
  fullGC,
  edenGC,
  drainMicrotasks,
  describeArray,
  describe,
  jsc_default as default,
  callerSourceOrigin
};

//# debugId=5558BFF6A3565C5664756e2164756e21
