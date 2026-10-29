// `x.m(..)` on a receiver that may be one of several: the method is read and called at once. Nothing can tell which function object was called, but everything else about the call has to be right:
// the receiver, a method that is replaced in the middle, a method that looks at itself, a method read as a value beside it.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "") as <T>(list: T[], i: number) => T;
class Celsius { constructor(public degrees: number) {} plus(n: number): number { return this.degrees + n; } static plus(n: number): Celsius { return new Celsius(n); } }
class Kelvin { constructor(public degrees: number) {} plus(n: number): number { return this.degrees + n + 273; } static plus(n: number): Kelvin { return new Kelvin(n); } }
class Named { constructor(public degrees: number) {} plus(n: number): number { return (this.plus as any).seen = ((this.plus as any).seen ?? 0) + n; } }
const literal = { degrees: 5, plus(n: number) { return this.degrees * n; } };
type Scale = { degrees: number; plus(n: number): number };
const scales: Scale[] = [new Celsius(1), new Kelvin(2), literal, new Named(3), { degrees: 7, plus: n => n - 1 }];
function callIt(s: Scale, n: number): number { return s.plus(n); }
function callOneOfTwo(i: number, n: number): number { const s = i & 1 ? new Celsius(i) : new Kelvin(i); return s.plus(n); }
function callStatic(i: number): number { const c = i & 1 ? Celsius : Kelvin; return c.plus(i).degrees; }
function callIfThere(s: Partial<Scale> & { degrees: number }, n: number): number { return s.plus?.(n) ?? -1; }
function readAndCompare(a: Scale, b: Scale): boolean { return a.plus === b.plus; }
function readKeepAndCall(s: Scale, kept: unknown[]): number { const f = s.plus; kept.push(f); return f.call(s, 1); }
let sum = 0;
const kept: unknown[] = [];
for (let i = 0; i < 3000; i++) {
  const s = pick(scales, i % scales.length);
  sum += callIt(s, i) + callOneOfTwo(i, 2) + callStatic(i) + callIfThere(s, i) + callIfThere({ degrees: 1 }, i);
  if (i === 1500) Celsius.prototype.plus = function (n: number) { return -n; };
  if (i === 2000) (Kelvin as any).plus = (n: number) => new Kelvin(-n);
  if (i % 500 === 0) sum += readKeepAndCall(s, kept) + (readAndCompare(new Celsius(1), new Celsius(2)) ? 1 : 0) + (readAndCompare(new Celsius(1), new Kelvin(2)) ? 10 : 0);
}
console.log(sum, kept.length, new Set(kept).size, (Named.prototype.plus as any).seen, kept[0] === scales[0].plus);

// The receiver is only expected to be what its type says, and the fast path is left BEHIND the read of the method: what an argument's own call answers has another shape, a field of it is missing, or
// evaluating the argument replaces the method. The method that was read before the arguments is the one to call.
class Label { constructor(public name: string) {} }
class Shelf { n = 0; constructor(public label: Label) {} }
class Shelves {
  map = new Map<string, Shelf>();
  shelfFor(label: Label): Shelf { let s = this.map.get(label.name); if (!s) this.map.set(label.name, (s = new Shelf(label))); s.n++; return s; }
}
type Crate = { label: Label };
const shelves: Shelves = pick([new Shelves()], 0);
const crates: Crate[] = [{ label: new Label("a") }, JSON.parse('{"more":1,"label":{"name":"b"}}'), Object.create({ label: new Label("c") }), { get label() { return new Label("d"); } }];
let replaceAt = -1;
const first = Shelves.prototype.shelfFor;
function crateAt(i: number): Crate {
  if (i === replaceAt) Shelves.prototype.shelfFor = function (this: Shelves, label: Label) { const s = first.call(this, label); s.n += 1000; return s; };
  return pick(crates, i % crates.length);
}
function shelfOf(i: number): Shelf { return shelves.shelfFor(crateAt(i).label); }
let total = 0;
for (let i = 0; i < 4000; i++) {
  if (i === 3000) replaceAt = 3001;
  const before = total;
  total += shelfOf(i).n;
  if (i >= 3000 && i <= 3002) console.log(i, total - before);
}
console.log(total, shelves.map.size, Shelves.prototype.shelfFor === first, [...shelves.map.values()].map(s => s.n).join());
