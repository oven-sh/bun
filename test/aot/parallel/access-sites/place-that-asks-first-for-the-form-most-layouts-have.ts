// Most classes that have these names hold them in slots of one narrow form: whole numbers, fractions, booleans, references. So a read under such a name asks first for an answer of that form.
// Receivers of which nothing is known come some hundred times to each place. Then come those for which the first question is the wrong one: other layouts, other kinds of values, and slots that hold a mark or that their field has left.
let reads = 0;
enum Kind { None = 0, One = 1, Two = 2, Many = 1000 }
class Leaf {
  kind: Kind = Kind.None; flags: Kind = Kind.None; tally: Kind = Kind.None; depth: Kind = Kind.None;
  total: number = 5000000000;
  ratio: number = 0.5;
  ready: boolean = false; done: boolean = false;
  peer: Leaf | null = null; parent: Leaf | null = null; left: Leaf | null = null; right: Leaf | null = null; last: Leaf | null = null;
}
class Twig {
  last: Twig | null = null; right: Twig | null = null; left: Twig | null = null; parent: Twig | null = null; peer: Twig | null = null;
  done: boolean = false; ready: boolean = false;
  ratio: number = 0.5;
  total: number = 6000000000;
  depth: Kind = Kind.None; tally: Kind = Kind.None; flags: Kind = Kind.None; kind: Kind = Kind.None;
  extra: Kind = Kind.None;
}
class Loose {
  tally: any = "c";
  total: any = "t";
  ratio: any = "r";
  ready: any = "y";
  peer: any = "p";
}
function makeLeaf(i: number) {
  const leaf = new Leaf();
  leaf.tally = (i | 0) as Kind; leaf.total = 5000000000 + i; leaf.ratio = i / 4; leaf.ready = i % 3 === 0; leaf.peer = i % 2 ? leaf : null;
  return leaf;
}
function makeTwig(i: number) {
  const twig = new Twig();
  twig.tally = (-i | 0) as Kind; twig.total = 6000000000 + i; twig.ratio = i / 8; twig.ready = i % 5 === 0; twig.peer = i % 3 ? twig : null;
  return twig;
}
// Objects of two classes never meet in a variable of which the build knows more than that it holds a caught value.
function hideLeaf(o: Leaf): any { try { throw o; } catch (caught) { return caught; } }
function hideTwig(o: Twig): any { try { throw o; } catch (caught) { return caught; } }
function hideLoose(o: Loose): any { try { throw o; } catch (caught) { return caught; } }
const leaf = (i: number) => hideLeaf(makeLeaf(i));
const twig = (i: number) => hideTwig(makeTwig(i));
const loose = () => hideLoose(new Loose());
// What stands behind each read keeps it from being the last thing that the function does.
function tallyOfOne(o: any) { const v = o.tally; reads++; return v; }
function totalOfOne(o: any) { const v = o.total; reads++; return v; }
function ratioOfOne(o: any) { const v = o.ratio; reads++; return v; }
function readyOfOne(o: any) { const v = o.ready; reads++; return v; }
function peerOfOne(o: any) { const v = o.peer; reads++; return v; }
function tallyOfMany(o: any) { const v = o.tally; reads++; return v; }
function totalOfMany(o: any) { const v = o.total; reads++; return v; }
function ratioOfMany(o: any) { const v = o.ratio; reads++; return v; }
function readyOfMany(o: any) { const v = o.ready; reads++; return v; }
function peerOfMany(o: any) { const v = o.peer; reads++; return v; }
function say(v: any, o: any) {
  if (v === o) return "itself";
  if (Object.is(v, -0)) return "-0";
  if (typeof v === "object" && v !== null) return "{" + v.constructor.name + "}";
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function attempt(f: () => any) { try { return f(); } catch (error: any) { return error.constructor.name; } }
function showOne(o: any) {
  return attempt(() => [tallyOfOne(o), totalOfOne(o), ratioOfOne(o), readyOfOne(o), peerOfOne(o)].map(v => say(v, o)).join(" "));
}
function showMany(o: any) {
  return attempt(() => [tallyOfMany(o), totalOfMany(o), ratioOfMany(o), readyOfMany(o), peerOfMany(o)].map(v => say(v, o)).join(" "));
}

let sum = 0;
for (let i = 0; i < 700; i++) {
  const o = leaf(i);
  sum += tallyOfOne(o) + totalOfOne(o) + ratioOfOne(o) + (readyOfOne(o) ? 1 : 0) + (peerOfOne(o) === o ? 1 : 0);
}
console.log(sum);
console.log(showOne(leaf(7)), "|", showOne(leaf(12)));

// Three layouts in turns at one place.
let mixed = "";
for (let i = 0; i < 2100; i++) {
  const line = showMany(i % 3 === 0 ? leaf(i) : i % 3 === 1 ? twig(i) : loose());
  if (i % 211 === 0) mixed += line + "\n";
}
console.log(mixed);

// The ends of each form.
const edges = makeLeaf(1);
const hiddenEdges = hideLeaf(edges);
edges.tally = -2147483648 as Kind;
console.log(showOne(hiddenEdges));
edges.tally = -2147483643 as Kind;
console.log(showOne(hiddenEdges));
edges.tally = -2147483644 as Kind;
console.log(showOne(hiddenEdges));
edges.tally = 2147483647 as Kind;
edges.total = -9007199254740991;
edges.ratio = -0;
console.log(showOne(hiddenEdges));
edges.ratio = NaN;
edges.total = 9007199254740991;
console.log(showOne(hiddenEdges));
edges.ratio = -Infinity;
edges.total = 3;
console.log(showOne(hiddenEdges));
edges.ratio = 3;
console.log(showOne(hiddenEdges), typeof ratioOfOne(hiddenEdges), [10, 20, 30, 40][ratioOfOne(hiddenEdges)]);

// Receivers that are no objects of these classes, at places that have their answers for Leaf.
const others: any[] = [
  5, 1.5, "text", true, Symbol.iterator, 10n, null, undefined,
  JSON.parse('{ "tally": 3, "total": 4, "ratio": 5, "ready": 6, "peer": 7 }'),
  JSON.parse('{ "peer": "first", "tally": "last" }'),
  Object.assign([1, 2], JSON.parse('{ "tally": "of an array" }')),
  Object.assign(function named() { }, JSON.parse('{ "ratio": "of a function" }')),
  Object.assign(Object.create(null), JSON.parse('{ "ready": "without a prototype" }')),
  Object.create(leaf(21)),
  new Proxy(leaf(22), { get(target, key) { return "trapped " + String(key); } }),
  loose(), twig(23), new Map(), /x/,
];
for (const other of others) console.log(showOne(other));
console.log(showOne(leaf(9)));

// Each field meets what its slot does not hold, leaves its slot, or is left out.
function storeInAll(o: any, v: any) { o.tally = v; o.total = v; o.ratio = v; o.ready = v; o.peer = v; }
function deleteAll(o: any) { delete o.tally; delete o.total; delete o.ratio; delete o.ready; delete o.peer; }
// No object that the program spells out has these names: what is written of one would be written of all.
const above = JSON.parse('{ "tally": "tally above", "total": "total above", "ratio": "ratio above", "ready": "ready above", "peer": "peer above" }');
const deeds: Array<(o: any) => void> = [
  o => { storeInAll(o, undefined); },
  o => { storeInAll(o, null); },
  o => { storeInAll(o, "a text"); },
  o => { storeInAll(o, 1.25); },
  o => { storeInAll(o, 7); },
  o => { storeInAll(o, true); },
  o => { storeInAll(o, o); },
  o => { storeInAll(o, { constructor: { name: "made" } }); },
  o => { storeInAll(o, 2 ** 40); },
  o => { storeInAll(o, -2147483648); },
  o => { storeInAll(o, NaN); },
  o => { deleteAll(o); },
  o => { delete o.tally; delete o.ratio; delete o.peer; },
  o => { Object.setPrototypeOf(o, above); },
  o => { Object.setPrototypeOf(o, above); deleteAll(o); },
  o => { Object.setPrototypeOf(o, above); delete o.total; delete o.ready; },
  o => { Object.setPrototypeOf(o, above); storeInAll(o, undefined); },
  o => { deleteAll(o); storeInAll(o, "again"); },
  o => { deleteAll(o); o.tally = 4; o.total = 5000000004; o.ratio = 4.5; o.ready = true; o.peer = null; },
  o => {
    Object.defineProperty(o, "tally", { get() { return "got tally"; }, configurable: true });
    Object.defineProperty(o, "total", { get() { return "got total"; }, configurable: true });
    Object.defineProperty(o, "ratio", { get() { return "got ratio"; }, configurable: true });
    Object.defineProperty(o, "ready", { get() { return "got ready"; }, configurable: true });
    Object.defineProperty(o, "peer", { get() { return "got peer"; }, configurable: true });
  },
  o => {
    Object.defineProperty(o, "tally", { value: "fixed tally", writable: false });
    Object.defineProperty(o, "total", { value: "fixed total", writable: false });
    Object.defineProperty(o, "ratio", { value: "fixed ratio", writable: false });
    Object.defineProperty(o, "ready", { value: "fixed ready", writable: false });
    Object.defineProperty(o, "peer", { value: "fixed peer", writable: false });
  },
  o => { Object.defineProperty(o, "tally", { enumerable: false }); Object.defineProperty(o, "peer", { enumerable: false }); },
  o => { Object.freeze(o); },
  o => { Object.seal(o); o.tally = 77; },
];
deeds.forEach((deed, at) => {
  const first = leaf(9);
  deed(first);
  console.log(at, showOne(first), "|", showOne(leaf(9)), "|", showMany(first));
  const second = twig(10);
  deed(second);
  console.log(at, showMany(second), "|", showOne(second));
});
for (let i = 0; i < 700; i++) sum += tallyOfOne(leaf(i)) + ratioOfOne(leaf(i));
console.log(sum, reads);
