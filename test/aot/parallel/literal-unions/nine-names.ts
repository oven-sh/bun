// The type and the table have nine names.
// An earlier compiler counted the lookups that it wrote out over the tags of a small table: TagLookupsWithOtherKeys = 0. No lookup is written out today: no-loop.ts waits for it.
type T = "a1" | "a2" | "a3" | "a4" | "a5" | "a6" | "a7" | "a8" | "green";
const map = new Map<T, number>([["a1", 1], ["a2", 2], ["a3", 3], ["a4", 4], ["a5", 5], ["a6", 6], ["a7", 7], ["a8", 8], ["green", 9]]);
const text: string = JSON.parse('"xgreenx"');
function use(x: T) { let r: number | undefined; for (let k = 0; k < 50; k++) r = map.get(x); return r; }
for (let i = 0; i < 4; i++) console.log(String(use(i === 2 ? (text.slice(1, 6) as T) : "a1")));
