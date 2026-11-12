// STATISTIC: IteratorAllocationsElidedInSpreads >= 6
// `[...m.values()]`, `[...m.keys()]`, `[...s.values()]`, `[...s.keys()]` in one place each, over collections of many kinds: the members are appended off the collection.
// What is no map or set as made goes as written: a subclass with a method of its own, a method laid on the object, a prototype laid under it.
function show(list: any[]): string { return list.length + ":" + list.map(x => (typeof x === "object" && x ? "o" : String(x))).join(",").slice(0, 70); }
function mapOf(n: number, f: (i: number) => any, key: (i: number) => any = i => "k" + i): Map<any, any> { const m = new Map<any, any>(); for (let i = 0; i < n; i++) m.set(key(i), f(i)); return m; }
class Odd extends Map<any, any> { *values(): any { yield "odd"; } *keys(): any { yield "oddkey"; } }
class Bare extends Map<any, any> { }
class OddSet extends Set<any> { *values(): any { yield "oddset"; } *keys(): any { yield "oddsetkey"; } }
const own: any = mapOf(2, i => i); own.values = function () { return ["own"][Symbol.iterator](); }; own.keys = function () { return ["ownkey"][Symbol.iterator](); };
const under: any = mapOf(2, i => i); Object.setPrototypeOf(under, { __proto__: Map.prototype, values() { return ["under"][Symbol.iterator](); }, keys() { return ["underkey"][Symbol.iterator](); } });
const named: any = mapOf(2, i => i); named.extra = 1;
function gaps(n: number, f: (i: number) => any, key: (i: number) => any, dropped: (i: number) => boolean): Map<any, any> { const m = mapOf(n, f, key); for (let i = 0; i < n; i++) if (dropped(i)) m.delete(key(i)); return m; }
const o = { tag: 1 };
const maps: any[] = [
  mapOf(4, i => i, i => i), mapOf(4, i => i), mapOf(4, i => "v" + i), mapOf(4, i => "v" + i, i => i), mapOf(4, i => i + 0.5, i => i), mapOf(3, i => [o, undefined, null][i]), mapOf(3, i => [true, false, o][i], i => i),
  gaps(12, i => i, i => i, i => i % 3 === 0), gaps(12, i => "v" + i, i => "k" + i, i => i % 3 === 0), gaps(12, i => i, i => "k" + i, i => i < 4), gaps(12, i => "v" + i, i => i, i => i > 7), gaps(6, i => i, i => i, _ => true),
  new Map(), mapOf(40, i => i, i => i), mapOf(300, i => "v" + i), mapOf(3000, i => i * 0.5, i => i), new Odd([[1, "a"]]), new Bare([[1, "a"], [2, "b"]]), own, under, named,
  mapOf(4, i => (i === 3 ? "t" : i), i => i), mapOf(4, i => (i === 3 ? 0.5 : i), i => i), mapOf(4, i => (i === 3 ? NaN : i + 0.5), i => i),
];
const lines: string[] = [];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < maps.length; i++) {
    const m = maps[(i * 7 + round) % maps.length] as Map<any, any>;
    const s: Set<any> = i % 5 === 4 ? new OddSet([1]) : new Set(Map.prototype.keys.call(m));
    if (i % 4 === 1 && s.size > 2) s.delete(Map.prototype.keys.call(m).next().value);
    lines.push([round, i, show([...m.values()]), show([...m.keys()]), show([...s.values()]), show([...s.keys()]), show([0, ...m.values()]), show([0.5, ...m.values()]), show(["t", ...m.keys()])].join(" | "));
  }
}
console.log(lines.join("\n"));
