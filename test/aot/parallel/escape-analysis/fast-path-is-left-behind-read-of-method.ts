// `shelves.shelfFor(crateAt(i).label)`: the receiver is only expected to be what its type says, the method is read, and then the fast path is left: what the argument's own call answers has another shape than
// its type promised, or the field is not where it was expected. The general code goes on in the middle of the expression with the method as a value. Nobody can tell which function object that is,
// but the receiver, the argument and the number of evaluations have to be right.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "") as <T>(list: T[], i: number) => T;
class Label { constructor(public name: string) {} }
class Shelf { n = 0; constructor(public label: Label) {} }
class Shelves {
  map = new Map<string, Shelf>();
  constructor(public label: string) {}
  shelfFor(label: Label): Shelf { let s = this.map.get(label.name); if (!s) this.map.set(label.name, (s = new Shelf(label))); s.n++; return s; }
  both(a: Label, b: Label): number { return this.shelfFor(a).n * 10 + this.shelfFor(b).n; }
}
type Crate = { label: Label };
const shelves: Shelves = pick([new Shelves("first")], 0);
const others: Shelves[] = [new Shelves("second"), new Shelves("third")];
let evaluations = 0;
const crates: Crate[] = [
  { label: new Label("a") },
  JSON.parse('{"more":1,"label":{"name":"b"}}'),
  Object.create({ label: new Label("c") }),
  { get label() { evaluations++; return new Label("d"); } },
  Object.assign(Object.create(null), { z: 1, y: 2, label: new Label("e") }),
];
function crateAt(i: number): Crate { evaluations++; return pick(crates, i % crates.length); }
function shelfOf(i: number): Shelf { return shelves.shelfFor(crateAt(i).label); }
function shelfOfOther(i: number): Shelf { return pick(others, i & 1).shelfFor(crateAt(i).label); }
function two(i: number): number { return shelves.both(crateAt(i).label, crateAt(i + 1).label); }
let total = 0;
for (let i = 0; i < 5000; i++) total += shelfOf(i).n + shelfOfOther(i).n + two(i);
console.log(total, evaluations, shelves.map.size, [...shelves.map.values()].map(s => s.label.name + s.n).join(), others.map(o => o.label + o.map.size).join());
try { (pick([null], 0) as unknown as Shelves).shelfFor(crateAt(0).label); } catch (e) { console.log((e as Error).constructor.name, evaluations); }
try { (pick([{ shelfFor: 1 }], 0) as unknown as Shelves).shelfFor(crateAt(0).label); } catch (e) { console.log((e as Error).constructor.name, evaluations); }
