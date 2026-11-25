// What a type lists as whole numbers is an int32 where the program reckons with a read of it. Nothing is proven of the object: the rows come out of `any`, and some hold what the type does not list.
import type { int32 } from "bun";
interface Holder { level: 1 | 2 | 3 }
interface Outer { inner: Holder }
function negated(holder: Holder): int32 { return -holder.level; }
function kept(holder: Holder): int32 { const n: int32 = -holder.level; return n; }
function take(n: int32): int32 { return n; }
function handed(holder: Holder): number { return take(-holder.level); }
function next(holder: Holder): int32 { return holder.level + 1; }
function inner(outer: Outer): int32 { return -outer.inner.level; }
function first(pair: [1 | 2 | 3, string]): int32 { return -pair[0]; }
function arms(holder: Holder): int32 { return holder.level > 1 ? -holder.level : 5; }
function most(holder: Holder): int32 { return Math.max(holder.level, 2); }
const rows: any[] = JSON.parse('[{"level":1},{"level":3},{"level":2},{"level":0},{"level":7},{"level":2.5},{"level":"7"},{}]');
for (let k = 0; k < 3; k++) for (const row of rows) console.log(negated(row), 1 / negated(row), kept(row), handed(row), next(row), inner({ inner: row }), first([row.level, "a"]), arms(row), most(row));
