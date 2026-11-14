// Numbers added to sets and maps by the host: unions, iterables, groups; int32s, doubles, -0, NaN, beyond 2^31, mixed with texts, objects, big integers and symbols; deleted, cleared and grown on the way.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? "symbol" : v instanceof Set ? "{" + [...v].map(x => (Object.is(x, -0) ? "-0" : typeof x === "symbol" ? "s" : String(x))).join(",") + "}" : v instanceof Map ? "{" + [...v].map(([k, x]) => String(k) + ":" + String(x)).join(",") + "}" : String(v)) + " "; log += "\n"; }
const symbol = Symbol("s"), object = { o: 1 };
const lists: any[][] = [[], [1, 2, 3], [0, -0, NaN, NaN, 0.5, -1.5], [2147483647, 2147483648, -2147483648, 4294967296, 1e300], [1, "1", 1n, symbol, object, null, undefined, true], Array.from({ length: 70 }, (_, i) => i * 3 - 20), Array.from({ length: 300 }, (_, i) => i % 7 ? i : i / 2), ["a", "b", "c"], [5n, 5, "5", 2n ** 70n]];
for (let round = 0; round < 4; round++) {
  for (const a of lists) {
    const set = new Set(a), map = new Map(a.map((x, i) => [x, i] as [any, number])); show(set, set.size, map, map.size);
    for (const b of lists) { const other = new Set(b); show(set.union(other), set.intersection(other), set.difference(other), set.symmetricDifference(other), set.isSubsetOf(other), set.isSupersetOf(other), set.isDisjointFrom(other), set.size, other.size); const both = new Set([...a, ...b]); both.delete(b[0]); for (const x of b) both.add(x); show(both, both.has(b[0])); }
    const grouped = Map.groupBy(a, x => (typeof x === "number" ? x % 3 : typeof x)); show([...grouped.keys()].map(String).join(), grouped.size);
    const grown = new Set(a); for (let i = 0; i < 40; i++) grown.add(i * (round + 1) / 2); show(grown, grown.size); for (const x of a) grown.delete(x); show(grown.union(new Set(a))); grown.clear(); show(grown.union(new Set([1, 2])), new Set(grown.union(new Set(a)).keys()));
    const from: Map<any, any> = new Map<any, any>(map); for (let i = 0; i < 20; i++) from.set(i, "v" + i).set(i / 4, object); show(from.size, from.get(1), from.get(0.25), from.get(NaN), from.get(-0)); show(new Set(from.keys()).size, new Map(from).size, new Set(function* () { yield* a; yield 1; yield 1.5; }()));
    const stepped: any[] = []; const walked = new Set(a); for (const x of walked) { stepped.push(String(x)); if (stepped.length < 12) walked.add(stepped.length * 1.5); if (stepped.length === 3) walked.delete(a[0]); } show(stepped.join(), walked);
  }
  show(new Set([1, 2, 3]).union(new Map([[4, 5]]) as any), new Set([1, 2]).union({ size: 2, has: () => true, keys: () => [7, -0, 7].values() } as any));
}
console.log(log.length, log);
