// Alone: whether the lookup is copied into the loop of its caller is a fact about the whole program.
// The lookup stands in no loop of its own.
// STATISTIC: TagLookupsWithOtherKeys = 1
type T = "red" | "green" | "blue";
const map = new Map<T, number>([["red", 1], ["green", 2], ["blue", 3]]);
const text: string = JSON.parse('"xgreenx"');
function use(x: T) { return map.get(x); }
for (let i = 0; i < 4; i++) console.log(String(use(i === 2 ? (text.slice(1, 6) as T) : "red")));
