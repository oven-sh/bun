// @module "bun:jsc"
const jsc = globalThis[Symbol.for("Bun.lazy")]("bun:jsc");

export const callerSourceOrigin = jsc.callerSourceOrigin;
export const jscDescribe = jsc.describe;
export const jscDescribeArray = jsc.describeArray;
/** Too easy to confuse with test describe */
export const describe = jscDescribe;
export const describeArray = jscDescribeArray;
export const drainMicrotasks = jsc.drainMicrotasks;
export const edenGC = jsc.edenGC;
export const fullGC = jsc.fullGC;
export const gcAndSweep = jsc.gcAndSweep;
export const getRandomSeed = jsc.getRandomSeed;
export const heapSize = jsc.heapSize;
export const heapStats = jsc.heapStats;
export const startSamplingProfiler = jsc.startSamplingProfiler;
export const samplingProfilerStackTraces = jsc.samplingProfilerStackTraces;
export const isRope = jsc.isRope;
export const memoryUsage = jsc.memoryUsage;
export const noInline = jsc.noInline;
export const noFTL = jsc.noFTL;
export const noOSRExitFuzzing = jsc.noOSRExitFuzzing;
export const numberOfDFGCompiles = jsc.numberOfDFGCompiles;
export const optimizeNextInvocation = jsc.optimizeNextInvocation;
export const releaseWeakRefs = jsc.releaseWeakRefs;
export const reoptimizationRetryCount = jsc.reoptimizationRetryCount;
export const setRandomSeed = jsc.setRandomSeed;
export const startRemoteDebugger = jsc.startRemoteDebugger;
export const totalCompileTime = jsc.totalCompileTime;
export const getProtectedObjects = jsc.getProtectedObjects;
export const generateHeapSnapshotForDebugging = jsc.generateHeapSnapshotForDebugging;
export const profile = jsc.profile;
export default jsc;
export const setTimeZone = jsc.setTimeZone;
export const setTimezone = setTimeZone;
