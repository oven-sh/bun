// One object literal inside another in untyped code, 200,000 times, kept alive: the pair is one cell of 32 bytes. In plain Bun it is two cells, 64 bytes.
import { heapStats } from "bun:jsc";

const N = 200_000;
function collect() { Bun.gc(true); Bun.gc(true); return heapStats(); }
function make(i) { return { a: { b: i } }; }
function use(x) { return x.a.b; }
const kept = new Array(N);
const before = collect();
for (let i = 0; i < N; i++) kept[i] = make(i);
let sum = 0;
for (let i = 0; i < N; i++) sum += use(kept[i]);
const after = collect();
console.log(sum, typeof kept[sum % N], "one cell a pair:", (after.objectCount - before.objectCount) / N < 1.05, "at most 32 bytes a pair:", (after.heapSize - before.heapSize) / N < 33);
