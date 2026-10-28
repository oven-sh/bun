// A table of more than sixteen values is made from the image. Each evaluation makes new objects, and whatever is done to them shows in no other evaluation.
interface Row { id: number; name: string; weight: number; tags: string[]; on: boolean; kind: "circle" | "square" | "line"; note?: string; next: Row | null; any: unknown }
function table(): Row[] {
  return [
    { id: 1, name: "one", weight: 0.5, tags: ["a", "bb"], on: true, kind: "circle", next: null, any: 1 },
    { id: 2, name: "two", weight: 1.5, tags: [], on: false, kind: "square", note: "second", next: null, any: "text" },
    { id: 3, name: "", weight: -0, tags: ["ccc"], on: true, kind: "line", note: undefined, next: null, any: null },
    { id: 4, name: "four", weight: NaN, tags: ["a", "bb", "ccc", "dddd"], on: false, kind: "circle", next: null, any: undefined },
    { id: 2147483648, name: "five", weight: 1e300, tags: ["x"], on: true, kind: "square", next: null, any: [1, "two", [3]] },
    { id: -6, name: "six", weight: 6, tags: ["y"], on: true, kind: "line", next: null, any: { deep: { deeper: [true, false, null] } } },
  ];
}
const show = (v: unknown) => JSON.stringify(v, (_, x) => x === undefined ? "<undefined>" : Object.is(x, -0) ? "<-0>" : typeof x === "number" && x !== x ? "<NaN>" : x);
const first = show(table());
console.log(first);
const changes: [string, (t: Row[]) => unknown][] = [
  ["a number", t => { t[0].id = 100; }], ["a fraction into a whole number", t => { t[0].id = 0.5; }], ["a string", t => { t[1].name = "changed"; }], ["a literal", t => { t[2].kind = "circle"; }],
  ["a boolean", t => { t[3].on = true; }], ["an optional field", t => { t[0].note = "now"; }], ["an optional field away", t => { delete t[1].note; }], ["a reference", t => { t[0].next = t[1]; }],
  ["an element of an inner array", t => { t[0].tags[0] = "z"; }], ["a push to an inner array", t => { t[1].tags.push("new"); }], ["an inner array", t => { t[3].tags = []; }], ["anything", t => { t[4].any = 5; (t[5].any as any).deep.deeper[0] = "in"; }],
  ["a new name", t => { (t[0] as any).extra = 1; }], ["a deleted field", t => { delete (t[0] as any).weight; }], ["frozen", t => Object.freeze(t[0]) && Object.freeze(t[0].tags) && Object.isFrozen(t[0])],
  ["a getter", t => { Object.defineProperty(t[2], "id", { get() { return 33; }, enumerable: true, configurable: true }); }], ["another prototype", t => { Object.setPrototypeOf(t[2], { inherited: 1 }); return (t[2] as any).inherited; }],
  ["rows swapped", t => { [t[0], t[5]] = [t[5], t[0]]; }], ["rows sorted", t => t.sort((a, b) => b.id - a.id).length], ["a row removed", t => t.splice(2, 1).length], ["a row added", t => t.push({ ...t[0], id: 7 })],
  ["assign", t => { Object.assign(t[1], t[0]); }], ["by text", new Function("t", "t[0].id = 'text'; t[1].tags.length = 0; t[2].added = t[3]; delete t[4].name") as (t: Row[]) => unknown],
];
for (const [what, change] of changes) {
  const kept = table(), changed = table();
  const result = change(changed);
  console.log(what, show(result) ?? "undefined", show(changed) === first, show(kept) === first, show(table()) === first);
  console.log(show(changed));
}
const a = table(), b = table();
console.log(a !== b, a.every((row, i) => row !== b[i] && row.tags !== b[i].tags), a[4].any !== b[4].any, (a[5].any as any).deep !== (b[5].any as any).deep, a[0].name === b[0].name);
for (const row of table()) console.log(Object.keys(row).join(), "note" in row, row.hasOwnProperty("note"), Object.entries(row).length, Object.is(row.weight, -0), typeof row.any, row.kind === "circle" ? 1 : row.kind === "square" ? 2 : 3);
for (const row of table()) { let names = ""; for (const k in row) names += k + ";"; const { id, tags, ...rest } = row; console.log(names, id, tags.length, Object.keys(rest).join(), show({ ...row }) === show(row), show(structuredClone(row)) === show(row)); }
