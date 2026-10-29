import { heapStats } from "bun:jsc";

class Query<T> extends Promise<T> {}

function countExecutables(): number {
  Bun.gc(true);
  return heapStats().objectTypeCounts.NativeExecutable ?? 0;
}

let ran = 0;
const settled: Promise<number>[] = [];
const before = countExecutables();
for (let i = 0; i < 2_000; i++) {
  settled.push(new Query<number>(resolve => resolve(i)).finally(() => void ran++));
  settled.push(new Query<number>((_, reject) => reject(new Error("rejected"))).finally(() => void ran++).catch(() => -1));
}
const whilePending = countExecutables() - before;
const values = await Promise.all(settled);
console.log(whilePending < 100 ? "finally() shares its executables" : "finally() allocated executables");
console.log(ran, values.length, values[0], values[1], values[3_998], values[3_999], settled[0] instanceof Query);
