import type jsc from 'bun:jsc';
import v8 from 'node:v8';
//import { setRandomSeed, getRandomSeed } from './mathrandom.js';
import { NotImplementedError, getCallSites } from '../utils/errors.js';
import { gc } from './bun.js';

const STUB = () => void 0;

function jscSerialize(value: any, options?: { binaryType: 'nodebuffer'; }): Buffer;
function jscSerialize(value: any, options?: { binaryType?: 'arraybuffer'; }): SharedArrayBuffer;
function jscSerialize(value: any, options?: { binaryType?: string }): Buffer | SharedArrayBuffer {
    const serialized = v8.serialize(value);
    if (options?.binaryType === 'nodebuffer') return serialized;
    else return new SharedArrayBuffer(serialized.byteLength);
}
// TODO: Investigate ways of making these the actual JSC serialization format (probably Bun WASM)
// TODO: whilst this works for common use-cases like Node <-> Node it still does not make it
// TODO: possible for Node <-> Bun transfers of this kind of data, which might be interesting to have.
export const serialize = jscSerialize satisfies typeof jsc.serialize;
export const deserialize = (value => {
    if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return v8.deserialize(Buffer.from(value));
    else return v8.deserialize(value);
}) satisfies typeof jsc.deserialize;

export const setTimeZone = ((timeZone: string) => {
    const resolvedTZ = Intl.DateTimeFormat(undefined, { timeZone }).resolvedOptions().timeZone;
    return process.env.TZ = resolvedTZ;
}) satisfies typeof jsc.setTimeZone;

export const callerSourceOrigin = (() => {
    const callsites: NodeJS.CallSite[] = getCallSites(2);
    // This may be inaccurate with async code. Needs more testing.
    let lastSeenURL = '';
    for (const callsite of callsites) {
        const sourceURL = callsite.getScriptNameOrSourceURL();
        if (sourceURL.startsWith('file://')) lastSeenURL = sourceURL;
    }
    return lastSeenURL;
}) satisfies typeof jsc.callerSourceOrigin;

// TODO: Like with jsc.serialize/deserialize, these may be possible with Bun WASM.
export const jscDescribe = (() => { throw new NotImplementedError('jsc.jscDescribe', STUB); }) satisfies typeof jsc.jscDescribe;
export const jscDescribeArray = (() => { throw new NotImplementedError('jsc.jscDescribeArray', STUB); }) satisfies typeof jsc.jscDescribeArray;
// These are no longer documented but still exist.
export const describe = jscDescribe;
export const describeArray = jscDescribeArray;

// Node.js only provides a singular non-configurable global GC function, so we have to make do with that.
export const edenGC = gc satisfies typeof jsc.edenGC;
export const fullGC = gc satisfies typeof jsc.fullGC;
export const gcAndSweep = gc satisfies typeof jsc.gcAndSweep;

export const drainMicrotasks = STUB satisfies typeof jsc.drainMicrotasks; // no-op
export const releaseWeakRefs = STUB satisfies typeof jsc.releaseWeakRefs; // no-op
export const startSamplingProfiler = STUB satisfies typeof jsc.startSamplingProfiler; // no-op
//! likely broken but needs more testing
export const startRemoteDebugger = STUB satisfies typeof jsc.startRemoteDebugger; // no-op

//! this is a really poor polyfill but it's better than nothing
export const getProtectedObjects = (() => { return [globalThis]; }) satisfies typeof jsc.getProtectedObjects;

export const getRandomSeed = 0; // TODO
export const setRandomSeed = 0; // TODO

export const heapSize = (() => { return v8.getHeapStatistics().used_heap_size; }) satisfies typeof jsc.heapSize;
export const heapStats = (() => {
    const stats = v8.getHeapStatistics();
    return {
        heapSize: stats.used_heap_size,
        heapCapacity: stats.total_available_size,
        extraMemorySize: stats.external_memory ?? 0,
        objectCount: 1, // TODO: how to get this in node?
        protectedObjectCount: getProtectedObjects().length,
        globalObjectCount: 2, // TODO: this one is probably fine hardcoded but is there a way to get this in node?
        protectedGlobalObjectCount: 1, // TODO: ^
        objectTypeCounts: {}, //! can't really throw an error here, so just return an empty object (TODO: how to get this in node?)
        protectedObjectTypeCounts: {} //! can't really throw an error here, so just return an empty object (TODO: how to get this in node?)
    };
}) satisfies typeof jsc.heapStats;

//! doubtful anyone relies on the return of this for anything besides debugging
export const isRope = (() => false) satisfies typeof jsc.isRope;

export const memoryUsage = (() => {
    const stats = v8.getHeapStatistics();
    const resUse = process.resourceUsage();
    return {
        current: stats.malloced_memory,
        peak: stats.peak_malloced_memory,
        currentCommit: stats.malloced_memory,
        peakCommit: stats.malloced_memory,
        pageFaults: resUse.minorPageFault + resUse.majorPageFault
    };
}) satisfies typeof jsc.memoryUsage;

//! these are likely broken, seemingly always returning undefined which does not match the documented return types
export const noFTL = (() => { return void 0 as unknown as Function; }) satisfies typeof jsc.noFTL;
export const noOSRExitFuzzing = (() => { return void 0 as unknown as Function; }) satisfies typeof jsc.noOSRExitFuzzing;
//! likely broken, seems to always returns zero
export const totalCompileTime = (() => 0) satisfies typeof jsc.totalCompileTime;
//! likely broken, seem to always returns 0 if any arguments are passed, undefined otherwise
export const numberOfDFGCompiles = ((...args) => args.length ? 0 : void 0 as unknown as number) satisfies typeof jsc.numberOfDFGCompiles;
export const reoptimizationRetryCount = ((...args) => args.length ? 0 : void 0 as unknown as number) satisfies typeof jsc.reoptimizationRetryCount;

//! The following are very likely impossible to ever polyfill.
export const profile = (() => {
    throw new NotImplementedError('jsc.profile is not polyfillable', STUB, true);
}) satisfies typeof jsc.profile;
export const optimizeNextInvocation = (() => {
    throw new NotImplementedError('jsc.optimizeNextInvocation is not polyfillable', STUB, true);
}) satisfies typeof jsc.optimizeNextInvocation;
