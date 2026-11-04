// A read that runs once has no place to remember anything at. Under a name that most classes hold in a narrow slot it asks the table of fields first. Every read below stands in the body of the module, outside of loops.
enum Kind { None = 0, One = 1, Two = 2, Many = 1000 }
class Leaf {
  kind: Kind = Kind.None; flags: Kind = Kind.None; tally: Kind = Kind.None; depth: Kind = Kind.None;
  ratio: number = 0.5;
  ready: boolean = false; done: boolean = false;
  peer: Leaf | null = null; parent: Leaf | null = null; left: Leaf | null = null; right: Leaf | null = null; last: Leaf | null = null;
}
class Twig {
  last: Twig | null = null; right: Twig | null = null; left: Twig | null = null; parent: Twig | null = null; peer: Twig | null = null;
  done: boolean = false; ready: boolean = false;
  ratio: number = 0.5;
  depth: Kind = Kind.None; tally: Kind = Kind.None; flags: Kind = Kind.None; kind: Kind = Kind.None;
  extra: Kind = Kind.None;
}
class Loose { tally: any = "t"; ratio: any = "r"; ready: any = "y"; peer: any = "p"; }
function makeLeaf(i: number) {
  const made = new Leaf();
  made.tally = (i | 0) as Kind; made.ratio = i / 4; made.ready = i % 3 === 0; made.peer = i % 2 ? made : null;
  return made;
}
function makeTwig(i: number) {
  const made = new Twig();
  made.tally = (-i | 0) as Kind; made.ratio = i / 8; made.ready = i % 5 === 0; made.peer = i % 3 ? made : null;
  return made;
}
// Objects of two classes never meet in a variable of which the build knows more than that it holds a caught value.
function hideLeaf(o: Leaf): any { try { throw o; } catch (caught) { return caught; } }
function hideTwig(o: Twig): any { try { throw o; } catch (caught) { return caught; } }
function hideLoose(o: Loose): any { try { throw o; } catch (caught) { return caught; } }
// The classes are made often, or their cells would stay as they are.
let made = 0;
for (let i = 0; i < 50; i++) made += makeLeaf(i).tally + makeTwig(i).tally;
function say(v: any, o: any) {
  if (v === o) return "itself";
  if (Object.is(v, -0)) return "-0";
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function storeInAll(o: any, v: any) { o.tally = v; o.ratio = v; o.ready = v; o.peer = v; }
function deleteAll(o: any) { delete o.tally; delete o.ratio; delete o.ready; delete o.peer; }
// No object that the program spells out has these names: what is written of one would be written of all.
const above = JSON.parse('{ "tally": "tally above", "ratio": "ratio above", "ready": "ready above", "peer": "peer above" }');

const a = hideLeaf(makeLeaf(7));
console.log(say(a.tally, a), say(a.ratio, a), say(a.ready, a), say(a.peer, a));
const b = hideTwig(makeTwig(9));
console.log(say(b.tally, b), say(b.ratio, b), say(b.ready, b), say(b.peer, b));
const c = hideLoose(new Loose());
console.log(say(c.tally, c), say(c.ratio, c), say(c.ready, c), say(c.peer, c));
const d = hideLeaf(makeLeaf(8));
storeInAll(d, undefined);
console.log(say(d.tally, d), say(d.ratio, d), say(d.ready, d), say(d.peer, d));
const e = hideLeaf(makeLeaf(8));
storeInAll(e, null);
console.log(say(e.tally, e), say(e.ratio, e), say(e.ready, e), say(e.peer, e));
const f = hideTwig(makeTwig(8));
storeInAll(f, "a text");
console.log(say(f.tally, f), say(f.ratio, f), say(f.ready, f), say(f.peer, f));
const g = hideLeaf(makeLeaf(8));
deleteAll(g);
console.log(say(g.tally, g), say(g.ratio, g), say(g.ready, g), say(g.peer, g));
const h = hideTwig(makeTwig(8));
Object.setPrototypeOf(h, above);
deleteAll(h);
console.log(say(h.tally, h), say(h.ratio, h), say(h.ready, h), say(h.peer, h));
const i = hideLeaf(makeLeaf(8));
Object.setPrototypeOf(i, above);
delete i.ratio;
delete i.peer;
console.log(say(i.tally, i), say(i.ratio, i), say(i.ready, i), say(i.peer, i));
const j = hideLeaf(makeLeaf(8));
Object.defineProperty(j, "tally", { get() { return "got tally"; }, configurable: true });
Object.defineProperty(j, "peer", { get() { return "got peer"; }, configurable: true });
console.log(say(j.tally, j), say(j.ratio, j), say(j.ready, j), say(j.peer, j));
const k = hideLeaf(makeLeaf(8));
storeInAll(k, -2147483648);
console.log(say(k.tally, k), say(k.ratio, k), say(k.ready, k), say(k.peer, k));
const l = hideLeaf(makeLeaf(8));
storeInAll(l, NaN);
console.log(say(l.tally, l), say(l.ratio, l), say(l.ready, l), say(l.peer, l));
const m: any = JSON.parse('{ "tally": 3, "peer": "parsed" }');
console.log(say(m.tally, m), say(m.ratio, m), say(m.ready, m), say(m.peer, m));
const n: any = JSON.parse("[5]")[0];
console.log(say(n.tally, n), say(n.ratio, n), say(n.ready, n), say(n.peer, n));
const o: any = JSON.parse('["text"]')[0];
console.log(say(o.tally, o), say(o.ratio, o), say(o.ready, o), say(o.peer, o));
const p: any = Object.create(hideLeaf(makeLeaf(21)));
console.log(say(p.tally, p), say(p.ratio, p), say(p.ready, p), typeof p.peer);
const q: any = new Proxy(hideLeaf(makeLeaf(22)), { get(target, key) { return "trapped " + String(key); } });
console.log(say(q.tally, q), say(q.ratio, q), say(q.ready, q), say(q.peer, q));
const r: any = JSON.parse("[null]")[0];
try { console.log(r.tally); } catch (error: any) { console.log(error.constructor.name); }
console.log(made);
