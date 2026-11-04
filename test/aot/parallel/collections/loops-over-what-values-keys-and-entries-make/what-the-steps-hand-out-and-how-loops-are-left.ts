const map = new Map<unknown, unknown>([["s", 1], [2, "two"], [NaN, -0], [null, undefined], [{ o: 1 }, [1]], [10n, Symbol.iterator]]);
const show = (value: unknown) => Object.is(value, -0) ? "-0" : typeof value === "symbol" || typeof value === "bigint" ? String(value) : JSON.stringify(value) ?? "undefined";
for (const key of map.keys()) console.log("key", show(key));
for (const value of map.values()) console.log("value", show(value));
const pairs: unknown[] = []; for (const pair of map.entries()) pairs.push(pair);
console.log(pairs.length, pairs[0] !== pairs[1], Array.isArray(pairs[0]), (pairs[0] as unknown[]).length, show(pairs[2]));
(pairs[0] as unknown[])[1] = "written"; console.log(map.get("s"));
function first(m: Map<unknown, unknown>) { for (const value of m.values()) return value; return "none"; }
console.log(show(first(map)), first(new Map()));
function throws(m: Map<unknown, unknown>) { try { for (const key of m.keys()) { if (key === 2) throw new Error("in the loop"); } } catch (error) { return (error as Error).message; } finally { console.log("finally"); } }
console.log(throws(map));
outer: for (const a of map.keys()) { for (const b of map.values()) { if (b === "two") continue outer; if (a === 2) break outer; console.log(show(a), show(b)); } }
const empty = new Map(); for (const value of empty.values()) console.log("never", value);
let turns = 0; for (const _ of map.values()) for (const __ of map.keys()) turns++; console.log(turns);
const set = new Set(["a", "b"]); for (const [one, two] of set.entries()) console.log(one, two, one === two);
