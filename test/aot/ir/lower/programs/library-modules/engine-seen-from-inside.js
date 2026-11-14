// RUN: lower
// OPTIONS: builtin-modules

// bun:jsc, node:v8 and node:vm's harmless parts: what kind of answer each function gives, a value that is serialized and read back, and sizes that are numbers.
import { heapStats, heapSize, memoryUsage, serialize, deserialize, estimateShallowMemoryUsageOf, gcAndSweep, jscDescribe } from "bun:jsc";
import v8 from "node:v8";

const stats = heapStats();
console.log(Object.keys(stats).sort().join(), stats.objectCount > 0, typeof stats.objectTypeCounts.Object, heapSize() > 0, Object.keys(memoryUsage()).sort().join());
const value = { text: "x", list: [1, 2n, new Date(0)], map: new Map([["k", new Set([1])]]), bytes: new Uint8Array([1, 2]) };
const copy = deserialize(serialize(value));
console.log(copy.text, copy.list[1], copy.list[2].getTime(), copy.map.get("k").has(1), copy.bytes.join(), serialize(1) instanceof SharedArrayBuffer || serialize(1) instanceof ArrayBuffer);
console.log(estimateShallowMemoryUsageOf({ a: 1 }) > 0, typeof gcAndSweep(), typeof jscDescribe({}));
const viaV8 = v8.deserialize(v8.serialize({ a: [1, "two", null], b: new Map([[1, 2]]) }));
console.log(JSON.stringify(viaV8.a), viaV8.b.get(1), Buffer.isBuffer(v8.serialize(1)));
console.log(Object.keys(v8.getHeapStatistics()).sort().join(), v8.getHeapStatistics().total_heap_size > 0, Array.isArray(v8.getHeapSpaceStatistics()), typeof v8.cachedDataVersionTag(), typeof v8.setFlagsFromString, typeof v8.writeHeapSnapshot, typeof v8.isStringOneByteRepresentation?.("a"));
console.log(JSON.stringify(structuredClone({ nested: { date: new Date(5), re: /x/g.source } })), structuredClone(new Error("cloned")).message);
