// Callbacks handed over: each function here has a second parameter that says string, as the program's call does, and one native caller that passes a number, an object or nothing there. A bit is set for each such caller.
import { EventEmitter } from "node:events";

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}
const list = [1];

function byMap(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 1; return 0; }
function byForEach(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 2; return 0; }
function byFilter(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 4; return 0; }
function bySome(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 8; return 0; }
function byEvery(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 16; return 0; }
function byFind(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 32; return 0; }
function byFindIndex(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 64; return 0; }
function byFindLast(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 128; return 0; }
function byFlatMap(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 256; return 0; }
function byArrayFrom(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 512; return 0; }
function byReduce(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 1024; return 0; }
function bySort(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 2048; return 0; }
function byToSorted(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 4096; return 0; }
function byTypedMap(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 8192; return 0; }
function byTypedSort(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 16384; return 0; }
function bySetForEach(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 32768; return 0; }
function byMapForEach(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 65536; return 0; }
function byGroupBy(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 131072; return 0; }
function byReplace(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 262144; return 0; }
function byReviver(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 524288; return 0; }
function byReplacer(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 1048576; return 0; }
function byIteratorMap(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 2097152; return 0; }
function byTimeout(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 4194304; return 0; }
function byImmediate(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 8388608; return 0; }
function byMicrotask(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 16777216; return 0; }
function byTick(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 33554432; return 0; }
function byThen(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 67108864; return 0; }
function byEmit(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 134217728; return 0; }
function byParams(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 268435456; return 0; }
function byHeaders(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 536870912; return 0; }
function byFromAsync(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= 1073741824; return 0; }

byMap(1, "t");
attempt(() => list.map(byMap as any));
byForEach(1, "t");
attempt(() => list.forEach(byForEach as any));
byFilter(1, "t");
attempt(() => list.filter(byFilter as any));
bySome(1, "t");
attempt(() => list.some(bySome as any));
byEvery(1, "t");
attempt(() => list.every(byEvery as any));
byFind(1, "t");
attempt(() => list.find(byFind as any));
byFindIndex(1, "t");
attempt(() => list.findIndex(byFindIndex as any));
byFindLast(1, "t");
attempt(() => list.findLast(byFindLast as any));
byFlatMap(1, "t");
attempt(() => list.flatMap(byFlatMap as any));
byArrayFrom(1, "t");
attempt(() => Array.from(list, byArrayFrom as any));
byReduce(1, "t");
attempt(() => list.reduce(byReduce as any, 0));
bySort(1, "t");
attempt(() => [2, 1].sort(bySort as any));
byToSorted(1, "t");
attempt(() => [2, 1].toSorted(byToSorted as any));
byTypedMap(1, "t");
attempt(() => new Uint8Array(1).map(byTypedMap as any));
byTypedSort(1, "t");
attempt(() => new Uint8Array(2).sort(byTypedSort as any));
bySetForEach(1, "t");
attempt(() => new Set(list).forEach(bySetForEach as any));
byMapForEach(1, "t");
attempt(() => new Map([[1, 1]]).forEach(byMapForEach as any));
byGroupBy(1, "t");
attempt(() => Object.groupBy(list, byGroupBy as any));
byReplace(1, "t");
attempt(() => "a".replace("a", byReplace as any));
byReviver(1, "t");
attempt(() => JSON.parse("1", byReviver as any));
byReplacer(1, "t");
attempt(() => JSON.stringify(1, byReplacer as any));
byIteratorMap(1, "t");
attempt(() => list.values().map(byIteratorMap as any).toArray());
byTimeout(1, "t");
attempt(() => setTimeout(byTimeout as any, 0, 1));
byImmediate(1, "t");
attempt(() => setImmediate(byImmediate as any, 1, 2));
byMicrotask(1, "t");
attempt(() => queueMicrotask(byMicrotask as any));
byTick(1, "t");
attempt(() => process.nextTick(byTick, 1, 2));
byThen(1, "t");
attempt(() => Promise.resolve(1).then(byThen as any));
byEmit(1, "t");
attempt(() => new EventEmitter().on("e", byEmit as any).emit("e", 1, 2));
byParams(1, "t");
attempt(() => new URLSearchParams("a=1").forEach(byParams as any, 1));
byHeaders(1, "t");
attempt(() => new Headers({ a: "1" }).forEach(byHeaders as any));
byFromAsync(1, "t");
attempt(() => Array.fromAsync(list, byFromAsync as any));
setTimeout(() => console.log(bits.toString(2)), 10);
