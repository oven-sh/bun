// STATISTIC: IteratorAllocationsElidedInSpreads >= 5
// Array.from(x.values()), [...x.keys()] where nothing says what x is, in what loops reach: a set or map as made is copied without its iterator, anything else goes as written.
"use strict";
const out = [];
const show = (run) => { try { const list = run(); return Array.isArray(list) ? list.length + ":" + list.map((each) => (typeof each === "object" && each ? Object.keys(each).join("") || each.constructor.name : typeof each + String(each))).join() : typeof list + String(list); } catch (error) { return error.constructor.name; } };
class OddSet extends Set { values() { return ["odd"][Symbol.iterator](); } keys() { return ["oddKey"][Symbol.iterator](); } }
class LateMap extends Map { *values() { yield* [1, 2]; } }
class Bare extends Map { }
class BareSet extends Set { }
class Own { constructor(n) { this.n = n; } values() { return new Set([this.n, this.n + 1]); } keys() { return [this.n]; } }
class Wrapped { constructor(inner) { this.inner = inner; } values() { return Array.from(this.inner.values()).reverse(); } *keys() { for (const key of [...this.inner.keys()]) yield key + "!"; } }
class Holder {
  constructor(x) { this.x = x; }
  values() { return Array.from(this.x.values()); }
  keys() { return Array.from(this.x.keys()); }
  spread() { return [...this.x.values()]; }
  spreadKeys() { return ["first", ...this.x.keys(), "last"]; }
  passed() { return Math.max(...this.x.values()); }
  counted() { let n = 0; for (const each of Array.from(this.x.values())) n += typeof each === "number" ? each : 1; return n; }
  entries() { return Array.from(this.x.entries()).map(String); }
}
const named = new Set([7, 8]); named.values = () => ["named"].values();
const extra = new Set([7, 8]); extra.more = 1;
const under = new Map([["a", 1]]); Object.setPrototypeOf(under, { __proto__: Map.prototype, values() { return [9][Symbol.iterator](); } });
const gaps = new Map([["a", 1], ["b", 2], ["c", 3]]); gaps.delete("b");
const emptied = new Set([1, 2, 3]); emptied.clear();
const big = new Set(Array.from({ length: 300 }, (_, i) => i * 0.5));
const mixed = new Map([[1, "t"], [2, undefined], [3, null], [4, { o: 1 }], [NaN, -0]]);
const things = [
  new Set([1, 2, 3]), new Map([["k", "v"], ["l", "w"]]), new Set(), new Map(), [4, 5, 6], ["x", , "z"], [], new Uint8Array([1, 2]), new Float64Array([0.5]),
  new OddSet([1]), new LateMap([[1, 2]]), new Bare([[3, 4]]), new BareSet(["b"]), new Own(5), new Wrapped(new Set([1, 2])), new Wrapped(new Map([["q", 1]])), named, extra, under, gaps, emptied, big, mixed,
  { values: () => "text", keys: () => new Map([["m", 1]]).keys() }, { values() { return null; }, keys() { return 5; } }, null, undefined, 5, "text", new Proxy(new Set([1]), {}), Object.create(Set.prototype), Object.create(new Set([1])), { get values() { out.push("read"); return () => [1].values(); }, keys: undefined },
  new URLSearchParams("a=1&b=2"), Object.freeze(new Set([1, 2])), new Set([1, 2]).values(), new Map([[1, 2]]).entries(),
];
const holders = things.map((x) => new Holder(x));
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < holders.length; i++) {
    const holder = holders[(i * 11 + round) % holders.length];
    out.push([round, i, show(() => holder.values()), show(() => holder.keys()), show(() => holder.spread()), show(() => holder.spreadKeys()), show(() => holder.passed()), show(() => holder.counted()), show(() => holder.entries())].join(" | "));
  }
}
const live = new Holder(new Set([1]));
for (let i = 0; i < 6; i++) { const list = live.values(); live.x.add(i * 2); list.push("own"); if (i === 3) live.x.delete(1); out.push(list.join() + " " + live.x.size); }
console.log(out.map((line) => line.slice(0, 300)).join("\n"));
