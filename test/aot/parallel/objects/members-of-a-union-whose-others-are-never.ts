// An intersection spreads over a union: Name & Id is Id | (Str & Id), and nothing is Str and Id. Its objects are read, stored to, copied and passed on through such types.
interface Base { pos: number; parent?: Decl }
interface Id extends Base { kind: "id"; text: string; weight: number }
interface Str extends Base { kind: "str"; text: string; quotes: boolean }
interface Computed extends Base { kind: "computed"; expression: Id }
type Name = Id | Str | Computed;
interface Decl { name: Name; size: number }
type Named = Decl & { name: Id };
interface Table { [name: string]: number }
const table: Table & Record<number, number> = { 1: 10, 2: 20 };

const decls: Decl[] = [];
for (let i = 0; i < 60; i++) {
  const id: Id = { kind: "id", text: "n" + i, weight: i * 2, pos: i };
  const name: Name = i % 3 === 0 ? id : i % 3 === 1 ? { kind: "str", text: "s" + i, quotes: i % 2 === 0, pos: i } : { kind: "computed", expression: id, pos: i };
  const decl: Decl = { name, size: i };
  name.parent = decl;
  decls.push(decl);
}
function isNamed(d: Decl): d is Named { return d.name.kind === "id"; }
function weigh(name: Name & Id, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) { sum += name.weight + name.text.length + name.pos; name.weight++; }
  return sum;
}
function own(name: Named["name"]): string { return Object.keys(name).join() + "=" + JSON.stringify({ ...name, parent: undefined }); }
function same(a: Name & Id, b: Name & Id): boolean { return a === b || (a.kind === b.kind && a.weight === b.weight); }
function total(all: Decl[]): number {
  let sum = 0;
  for (const d of all) {
    if (isNamed(d)) sum += weigh(d.name, 3) + d.size;
    else if (d.name.kind === "computed") sum += weigh(d.name.expression, 2);
    else sum -= d.name.text.length;
  }
  return sum;
}
for (let k = 0; k < 8; k++) console.log(total(decls));
const named = decls.filter(isNamed);
console.log(named.map(d => d.name.weight).join(), own(named[1].name), same(named[0].name, named[0].name), same(named[0].name, named[1].name), table[2]);
// What the types do not say.
const odd: any[] = [{ weight: 1.5, text: [1, 2], pos: 0 }, { text: "x", pos: 1, get weight() { return 7; }, set weight(v) {} }, Object.freeze({ weight: 2, text: "y", pos: 2 }), { text: "no", pos: 3 }, "text"];
for (const o of odd) {
  try { console.log(weigh(o, 3)); } catch (e) { console.log((e as Error).constructor.name); }
}
console.log(total(decls.map(d => ({ ...d, name: { ...d.name } }) as Decl)));
