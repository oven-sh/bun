// OLD objects are given YOUNG cells that are not the value stored: another shape, new storage, a first table. Every round begins with shapes that no earlier round has seen, lets objects of them grow old, teaches every road on objects that die at once, and then sends the old objects down the same roads with values that are no cells. A collection of the young looks at an old object only if it has been told of it.
// Env: BUN_JSC_verifyGC=1
declare const edenGC: undefined | (() => void);
const values: unknown[] = [0, true, null, undefined, 1.5, false];
let kept = 0;
const garbage = typeof edenGC === "function" ? 3000 : 150000;
function churn() { for (let i = 0; i < garbage; i++) kept += JSON.parse('{"a":1,"b":2,"c":3}').c + [i, i + 1, i + 2, i + 3].length; if (typeof edenGC === "function") edenGC(); }
class Point { x = 1; y = 2; [name: string]: unknown }
class Counter { #n = 0; label = "c"; bump() { return ++this.#n; } }
class Holder { item: { r: number } | null = null; list: number[] | null = null; text = ""; }
type Pair = { p0: number; p1: number };
const sumOfPair = (o: any) => { const pair = o as Pair; return pair.p0 + pair.p1; };
const cell = () => { let held: { r: number } | null = null; return { set(v: { r: number }) { held = v; }, get() { return held; } }; };
type Road = { name: string; make: (round: number) => any; go: (o: any, round: number, v: unknown) => void; right: (o: any, round: number, v: unknown) => boolean };
const byName = (o: any, v: unknown) => { o.g = v; };
const byTwoNames = (o: any, v: unknown) => { o.g = v; o.h = v; };
const byKey = (o: any, k: PropertyKey, v: unknown) => { o[k] = v; };
const mark = Symbol("mark");
const parsed = (round: number, more: number) => { let text = '{"r' + round + '":0'; for (let i = 0; i < more; i++) text += ',"p' + i + '":' + i; return JSON.parse(text + "}"); };
const roads: Road[] = [
  { name: "a store by name, room in the object", make: r => parsed(r, 2), go: (o, r, v) => byName(o, v), right: (o, r, v) => o.g === v && o.p1 === 1 },
  { name: "two stores by name, the first storage out of line", make: r => parsed(r, 5), go: (o, r, v) => byTwoNames(o, v), right: (o, r, v) => o.g === v && o.h === v && o.p4 === 4 },
  { name: "a store under a string", make: r => parsed(r, 2), go: (o, r, v) => byKey(o, "k" + (r & 3), v), right: (o, r, v) => o["k" + (r & 3)] === v },
  { name: "a store under a symbol", make: r => parsed(r, 3), go: (o, r, v) => byKey(o, mark, v), right: (o, r, v) => o[mark] === v },
  { name: "Object.assign of a literal", make: r => parsed(r, 2), go: (o, r, v) => { Object.assign(o, { g: v, h: v }); }, right: (o, r, v) => o.g === v && o.h === v },
  { name: "Object.assign of what was parsed", make: r => parsed(r, 2), go: (o, r, v) => { Object.assign(o, JSON.parse('{"s":1,"t":2.5,"u":true}')); }, right: o => o.s === 1 && o.t === 2.5 && o.u === true },
  { name: "Object.defineProperty", make: r => parsed(r, 2), go: (o, r, v) => { Object.defineProperty(o, "g", { value: v, writable: true, enumerable: true, configurable: true }); }, right: (o, r, v) => o.g === v },
  { name: "a delete and a store", make: r => parsed(r, 3), go: (o, r, v) => { delete o.p1; o.g = v; }, right: (o, r, v) => o.g === v && !("p1" in o) && o.p2 === 2 },
  { name: "another prototype", make: r => parsed(r, 2), go: (o, r) => { Object.setPrototypeOf(o, { from: r }); }, right: (o, r) => o.from === r && o.p1 === 1 },
  { name: "frozen", make: r => parsed(r, 2), go: o => { Object.freeze(o); }, right: o => Object.isFrozen(o) && o.p1 === 1 },
  { name: "a name the class does not declare", make: () => new Point(), go: (o, r, v) => { o["e" + r] = v; }, right: (o, r, v) => o["e" + r] === v && o.x === 1 },
  { name: "two names the class does not declare", make: () => new Point(), go: (o, r, v) => { o["e" + r] = v; o["f" + r] = v; }, right: (o, r, v) => o["f" + r] === v && o.y === 2 },
  { name: "a property on a function", make: r => { const f = function () { return r; }; return f; }, go: (o, r, v) => { o["e" + r] = v; }, right: (o, r, v) => o["e" + r] === v && o() === r },
  { name: "a property on an array", make: r => [r, 2], go: (o, r, v) => { o["e" + r] = v; }, right: (o, r, v) => o["e" + r] === v && o[0] === r },
  { name: "numbers pushed onto an array", make: () => [1], go: (o, r) => { for (let i = 0; i < 9; i++) o.push(r + i); }, right: (o, r) => o.length === 10 && o[9] === r + 8 },
  { name: "doubles pushed onto an array of integers", make: () => [1, 2], go: (o, r) => { o.push(r + 0.5); }, right: (o, r) => o[2] === r + 0.5 && o[0] === 1 },
  { name: "numbers under strings in a Map", make: () => new Map<string, number>(), go: (o, r) => { for (let i = 0; i < 12; i++) o.set("m" + r + "_" + i, i); }, right: (o, r) => o.size === 12 && o.get("m" + r + "_11") === 11 },
  { name: "numbers in a Map that has entries", make: r => new Map<unknown, unknown>([["a" + r, 1]]), go: (o, r) => { for (let i = 0; i < 12; i++) o.set(r * 100 + i, i); }, right: (o, r) => o.size === 13 && o.get(r * 100 + 11) === 11 && o.get("a" + r) === 1 },
  { name: "strings in a Set", make: () => new Set<string>(), go: (o, r) => { for (let i = 0; i < 12; i++) o.add("s" + r + "_" + i); }, right: (o, r) => o.size === 12 && o.has("s" + r + "_11") },
  { name: "numbers in a Set", make: () => new Set<number>(), go: (o, r) => { for (let i = 0; i < 12; i++) o.add(r * 100 + i); }, right: (o, r) => o.size === 12 && o.has(r * 100 + 11) },
  { name: "a private field counts", make: () => new Counter(), go: o => { o.bump(); o.bump(); }, right: o => o.bump() === 3 && o.label === "c" },
  { name: "an index far out", make: r => parsed(r, 2), go: (o, r, v) => { o[5000 + r] = v; }, right: (o, r, v) => o[5000 + r] === v && o.p1 === 1 },
  { name: "read as a declared type", make: r => parsed(r, 2), go: o => { kept += sumOfPair(o); }, right: (o, r) => o.p0 === 0 && o.p1 === 1 && o["r" + r] === 0 && Object.keys(o).length === 3 },
  { name: "a young object into a declared field", make: () => new Holder(), go: (o, r) => { o.item = { r }; }, right: (o, r) => o.item.r === r },
  { name: "a young array and a young string into declared fields", make: () => new Holder(), go: (o, r) => { o.list = [r, r + 1]; o.text = "t" + r; }, right: (o, r) => o.list[1] === r + 1 && o.text === "t" + r },
  { name: "a young object into a variable of a closure", make: () => cell(), go: (o, r) => { o.set({ r }); }, right: (o, r) => o.get().r === r },
  { name: "a young object into an element", make: () => [null, null], go: (o, r) => { o[1] = { r }; }, right: (o, r) => o[1].r === r },
  { name: "a young object over a value of a Map", make: r => new Map<string, unknown>([["a", 1], ["b" + r, 2]]), go: (o, r) => { o.set("a", { r }); }, right: (o, r) => o.get("a").r === r && o.get("b" + r) === 2 },
  { name: "a young object over a property", make: r => parsed(r, 2), go: (o, r) => { o.p1 = { r }; byKey(o, "p0", { r }); }, right: (o, r) => o.p1.r === r && o.p0.r === r },
  { name: "a young object in a WeakMap under an old key", make: r => ({ key: parsed(r, 1), map: new WeakMap<object, unknown>() }), go: (o, r) => { o.map.set(o.key, { r }); }, right: (o, r) => o.map.get(o.key).r === r },
  { name: "an accessor", make: r => parsed(r, 2), go: (o, r) => { Object.defineProperty(o, "g", { get() { return r; }, configurable: true }); }, right: (o, r) => o.g === r },
];
const rounds = 10, each = 24;
const wrong = new Array(roads.length).fill(0);
const all: { road: number; round: number; index: number; object: any }[] = [];
for (let round = 0; round < rounds; round++) {
  const old: any[][] = roads.map(road => { const list = []; for (let i = 0; i < each; i++) list.push(road.make(round)); return list; });
  churn();
  roads.forEach((road, which) => {
    for (let turn = 0; turn < 6; turn++) road.go(road.make(round), round, values[turn]);
    for (let i = 0; i < each; i++) { road.go(old[which][i], round, values[i % values.length]); all.push({ road: which, round, index: i, object: old[which][i] }); }
  });
  churn();
}
for (const one of all) { let ok = false; try { ok = roads[one.road].right(one.object, one.round, values[one.index % values.length]); } catch { ok = false; } if (!ok) wrong[one.road]++; }
roads.forEach((road, which) => console.log(road.name + ": " + wrong[which]));
console.log(kept > 0);
