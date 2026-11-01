// One function asks one object both for its fields (are they where its layout puts them?) and for its prototype (is it still the one of its class?).
// Each question has its own answer: an object that has lost one of the two keeps the other, before, between and behind the two accesses.
class Point {
  x: number;
  y: number;
  label?: string;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
  norm(): number { return this.x * this.x + this.y * this.y; }
  get sum(): number { return this.x + this.y; }
}
interface Options { depth: number; width?: number; name?: string }
const launder = new Function("v", process.env.LAUNDER_TEXT ?? "return v") as <V>(v: V) => V;
const show = (label: string, value: unknown) => console.log(label, typeof value === "number" ? value : JSON.stringify(value) ?? String(value));

function fieldThenMethod(p: Point): number { return p.x + p.norm(); }
function methodThenField(p: Point): number { return p.norm() + p.y; }
function fieldAbsentField(p: Point): string { return p.x + ":" + p.label + ":" + p.y; }
function fieldGetterField(p: Point): number { return p.x * 100 + p.sum * 10 + p.y; }
function optionsAll(o: Options): string { return o.depth + "|" + o.width + "|" + o.name; }
function between(p: Point, change: (p: Point) => void): string { const before = p.x; change(p); return before + "," + p.norm() + "," + p.x + "," + p.label; }
function inLoop(list: Point[], change: (p: Point, i: number) => void): number { let total = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; total += p.x; change(p, i); total += p.norm() + p.y; } return total; }
function branches(p: Point, which: number): number { let r = p.x; if (which & 1) r += p.norm(); else r += p.y; if (which & 2) r += p.sum; return r; }

function all(label: string, make: () => Point) {
  show(label + " fieldThenMethod", fieldThenMethod(make()));
  show(label + " methodThenField", methodThenField(make()));
  show(label + " fieldAbsentField", fieldAbsentField(make()));
  show(label + " fieldGetterField", fieldGetterField(make()));
  for (let which = 0; which < 4; which++) show(label + " branches " + which, branches(make(), which));
}

const other = { norm(this: Point) { return -1; }, get sum() { return -2; }, label: "inherited" };
all("as born", () => new Point(3, 4));
all("seen by others", () => launder(new Point(3, 4)));
all("another prototype", () => { const p = new Point(3, 4); Object.setPrototypeOf(p, other); return p; });
all("no prototype but own members", () => { const p = new Point(3, 4); Object.setPrototypeOf(p, null); (p as any).norm = () => 9; return p; });
all("a field deleted", () => { const p = new Point(3, 4); delete (p as any).x; return p; });
all("a field deleted and another prototype", () => { const p = new Point(3, 4); delete (p as any).y; Object.setPrototypeOf(p, other); return p; });
all("a field is an accessor", () => { const p = new Point(3, 4); Object.defineProperty(p, "x", { get() { return 30; }, configurable: true }); return p; });
all("a field holds a string", () => { const p = new Point(3, 4); (p as any).y = "four"; return p; });
all("an own method", () => { const p = new Point(3, 4); (p as any).norm = function () { return 1000; }; return p; });
all("an own label", () => { const p = new Point(3, 4); p.label = "own"; return p; });
all("frozen", () => Object.freeze(new Point(3, 4)));
all("made by Object.create", () => { const p = Object.create(Point.prototype) as Point; p.y = 4; p.x = 3; return p; });
all("below the class", () => new (class Deeper extends Point { norm() { return 77; } })(3, 4));

const changes: [string, (p: Point) => void][] = [
  ["nothing", () => {}],
  ["prototype", (p) => { Object.setPrototypeOf(p, other); }],
  ["delete x", (p) => { delete (p as any).x; }],
  ["x becomes text", (p) => { (p as any).x = "text"; }],
  ["own norm", (p) => { (p as any).norm = () => 5; }],
  ["label", (p) => { p.label = "late"; }],
  ["both", (p) => { delete (p as any).x; Object.setPrototypeOf(p, other); }],
];
for (const [label, change] of changes) {
  show("between: " + label, between(new Point(3, 4), change));
  show("between, unseen: " + label, between(new Point(3, 4), launder(change)));
  show("in a loop: " + label, inLoop([new Point(1, 2), new Point(3, 4), new Point(5, 6)], (p, i) => { if (i === 1) change(p); }));
}

show("options", optionsAll({ depth: 1 }));
show("options", optionsAll({ depth: 1, width: 2 }));
show("options", optionsAll(launder({ depth: 1, name: "n" })));
show("options under a prototype", optionsAll(Object.setPrototypeOf({ depth: 1 }, { width: 7, name: "from above" })));
show("options by Object.create", optionsAll(Object.assign(Object.create({ name: "above" }), { depth: 2 })));
(Point.prototype as any).label = "on the class";
all("a name arrives on the class", () => new Point(3, 4));
