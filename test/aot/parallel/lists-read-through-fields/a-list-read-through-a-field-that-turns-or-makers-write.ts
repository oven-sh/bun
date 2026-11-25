// A list is read through a field in a loop. The field is read in front of the loop, the state holds what it held there, and the list gets its own front. Here the field does not hold the same in every turn:
// the field is written in the turn by the loop itself, by an alias, by a callee, by a setter and by code that nobody knows; the loop stands in the constructor, in a field's initializer, in a function that the constructor calls, in the function that made the object.
const out: unknown[] = [];
const unknown: ((f: () => void) => void)[] = JSON.parse("[0]").map(() => (f: () => void) => f());
class Moving { items: number[] = [1.5, 2.5, 3.5]; other: number[] = [10.5, 20.5, 30.5, 40.5];
  own(): number { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]!; if (i === 0) this.items = this.other; } return s; }
  swap(): void { const t = this.items; this.items = this.other; this.other = t; }
  byCallee(): number { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]!; this.swap(); } return s; }
  byUnknown(): number { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]!; unknown[0]!(() => this.swap()); } return s; }
  set both(v: number[]) { this.items = v; }
  bySetter(): number { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]!; this.both = i & 1 ? [7.5, 8.5, 9.5] : [100.5, 200.5, 300.5, 400.5]; } return s; } }
function byAlias(a: Moving, b: Moving): number { let s = 0; for (let i = 0; i < a.items.length; i++) { s += a.items[i]!; b.items = [0.5, 0.25, 0.125, 0.0625]; } return s; }
{ const m = new Moving(); out.push(m.own(), new Moving().byCallee(), new Moving().byUnknown(), new Moving().bySetter(), byAlias(m, m), byAlias(new Moving(), new Moving())); }
class Built { readonly items: number[] = [1.5]; readonly seen: number; readonly doubled: number[] = this.items.map(x => x * 2);
  constructor(n: number) { let s = 0; for (let i = 0; i < n; i++) { this.items.push(i + 0.5); s += this.items[i]! + this.items.length; } this.seen = s + this.total(); (this as { items: number[] }).items = [9.5, 8.5]; this.seen += this.total(); }
  total(): number { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]!; return s; } }
{ const b = new Built(4); out.push(b.seen, b.total(), b.doubled.join()); }
class Twice { readonly items: number[]; constructor(n: number) { this.items = [0.5]; let s = 0; for (let t = 0; t < n; t++) { for (let i = 0; i < this.items.length; i++) s += this.items[i]!; this.items = [...this.items, t + 1.5]; } out.push(s); } }
out.push(new Twice(4).items.join());
function made(n: number): number { const o = { items: [1.5, 2.5] }; let s = 0; for (let i = 0; i < o.items.length && i < n; i++) { s += o.items[i]!; if (i === 0) o.items = [5.5, 6.5, 7.5]; } return s; }
out.push(made(5), made(0));
class Waits { readonly items: number[]; readonly done: Promise<number>; constructor() { this.items = [1.5, 2.5]; this.done = this.slowly(); this.items = [10.5, 20.5, 30.5]; }
  async slowly(): Promise<number> { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]!; await null; } return s; }
  *steps(): Generator<number> { for (let i = 0; i < this.items.length; i++) yield this.items[i]!; } }
class Stepped extends Waits { readonly first: number[]; constructor() { super(); this.first = []; } }
{ const w = new Waits(); out.push(await w.done, [...w.steps()].join(), await new Stepped().done); }
console.log(out.join("|"));
