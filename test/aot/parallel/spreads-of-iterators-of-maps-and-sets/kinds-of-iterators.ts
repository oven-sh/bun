// `[...m.values()]`, `[...m.keys()]`, `[...s.values()]`: the members go from the table into the list. Each kind of iterator, table and target answers as written.
function show(list: any[]): string { return list.length + ":" + list.map(x => (Array.isArray(x) ? "[" + x.join("/") + "]" : typeof x === "object" && x ? "o" : String(x))).join(","); }
function mapOf(n: number, f: (i: number) => any): Map<any, any> { const m = new Map<any, any>(); for (let i = 0; i < n; i++) m.set("k" + i, f(i)); return m; }
const o = { tag: 1 };
const maps: Map<any, any>[] = [
  new Map(), new Map([[1, 1], [2, 2], [3, 3], [4, 4]]), new Map<any, any>([[1, 1.5], [2, 2.5]]), new Map<any, any>([["a", "x"], ["b", o], ["c", undefined], ["d", null]]),
  new Map<any, any>([[1, 1], [2, 2.5], [3, "t"]]), new Map<any, any>([[NaN, NaN], [0, -0], [-0, 7]]), mapOf(40, i => i), mapOf(3000, i => i * 0.5), mapOf(10, i => (i & 1 ? i : "s" + i)),
];
const withGaps = mapOf(12, i => i); for (let i = 0; i < 12; i += 3) withGaps.delete("k" + i); maps.push(withGaps);
const cleared = mapOf(5, i => i); cleared.clear(); cleared.set("again", 1); maps.push(cleared);
const lines: string[] = [];
for (let i = 0; i < maps.length; i++) {
  const m = maps[i];
  const s = new Set(m.values());
  lines.push([i, show([...m.values()]).slice(0, 90), show([...m.keys()]).slice(0, 90), show([...m.entries()]).slice(0, 90), show([...m]).slice(0, 60), show([...s.values()]).slice(0, 90), show([...s.keys()]).slice(0, 90), show([...s.entries()]).slice(0, 60), show([...s]).slice(0, 60)].join(" | "));
  lines.push([i, show([0, ...m.values()]).slice(0, 60), show([0.5, ...m.values()]).slice(0, 60), show(["t", ...m.keys(), "u"]).slice(0, 60), show([...m.values(), ...m.keys()]).slice(0, 90), show([...s.values(), 1]).slice(0, 60)].join(" | "));
}
console.log(lines.join("\n"));
