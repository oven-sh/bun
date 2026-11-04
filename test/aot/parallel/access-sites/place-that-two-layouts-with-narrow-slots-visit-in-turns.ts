// Objects of two classes that hold a name in a narrow slot come in turns to one place. It remembers the one layout by its shape and the other by the Structure of its object, so neither drives the other out.
// `tally` and `peer` are narrow in most classes that have them, so their reads ask for that form first. `girth` and `mate` are whole values in most, so theirs ask as at every place.
let reads = 0;
enum Kind { None = 0, One = 1, Two = 2, Many = 1000 }
class Leaf {
  kind: Kind = Kind.None; flags: Kind = Kind.None; tally: Kind = Kind.None; girth: Kind = Kind.None;
  ready: boolean = false; done: boolean = false;
  peer: Leaf | null = null; mate: Leaf | null = null; left: Leaf | null = null; right: Leaf | null = null; last: Leaf | null = null; parent: Leaf | null = null;
}
class Twig {
  parent: Twig | null = null; last: Twig | null = null; right: Twig | null = null; left: Twig | null = null; mate: Twig | null = null; peer: Twig | null = null;
  done: boolean = false; ready: boolean = false;
  girth: Kind = Kind.None; tally: Kind = Kind.None; flags: Kind = Kind.None; kind: Kind = Kind.None;
  extra: Kind = Kind.None;
}
class WideOne { girth: any = "g1"; mate: any = "m1"; }
class WideTwo { mate: any = "m2"; girth: any = "g2"; tail: any = 0; }
class WideThree { head: any = 0; girth: any = "g3"; mate: any = "m3"; }
function makeLeaf(i: number) {
  const made = new Leaf();
  made.tally = (i | 0) as Kind; made.girth = ((i * 2) | 0) as Kind; made.peer = i % 2 ? made : null; made.mate = i % 3 ? made : null;
  return made;
}
function makeTwig(i: number) {
  const made = new Twig();
  made.tally = (-i | 0) as Kind; made.girth = ((i * -2) | 0) as Kind; made.peer = i % 3 ? made : null; made.mate = i % 2 ? made : null;
  return made;
}
// Objects of two classes never meet in a variable of which the build knows more than that it holds a caught value.
function hideLeaf(o: Leaf): any { try { throw o; } catch (caught) { return caught; } }
function hideTwig(o: Twig): any { try { throw o; } catch (caught) { return caught; } }
function hideOne(o: WideOne): any { try { throw o; } catch (caught) { return caught; } }
function hideTwo(o: WideTwo): any { try { throw o; } catch (caught) { return caught; } }
function hideThree(o: WideThree): any { try { throw o; } catch (caught) { return caught; } }
const leaf = (i: number) => hideLeaf(makeLeaf(i));
const twig = (i: number) => hideTwig(makeTwig(i));
// What stands behind each read keeps it from being the last thing that the function does.
function tallyOf(o: any) { const v = o.tally; reads++; return v; }
function peerOf(o: any) { const v = o.peer; reads++; return v; }
function girthOf(o: any) { const v = o.girth; reads++; return v; }
function mateOf(o: any) { const v = o.mate; reads++; return v; }
function say(v: any, o: any) {
  if (v === o) return "itself";
  if (typeof v === "object" && v !== null) return "{" + v.constructor.name + "}";
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function attempt(f: () => any) { try { return f(); } catch (error: any) { return error.constructor.name; } }
function show(o: any) {
  return attempt(() => [tallyOf(o), peerOf(o), girthOf(o), mateOf(o)].map(v => say(v, o)).join(" "));
}
// Places that lie side by side share the count of how long one waits to be filled again, and it grows with each filling. So each place has its turns to itself, and the later ones more of them.
let sum = 0;
function visit(read: (o: any) => any, turns: number) {
  for (let i = 0; i < turns; i++) {
    const o = i % 2 ? leaf(i) : twig(i);
    const v = read(o);
    sum += v === o ? 1 : v === null ? 2 : v;
  }
}
visit(peerOf, 600);
visit(mateOf, 1500);
visit(tallyOf, 4000);
visit(girthOf, 12000);
console.log(sum);
let lines = "";
for (let i = 0; i < 1200; i++) {
  const line = show(i % 2 ? leaf(i) : twig(i));
  if (i % 107 === 0) lines += line + "\n";
}
console.log(lines);
console.log(show(hideOne(new WideOne())), "|", show(hideTwo(new WideTwo())), "|", show(hideThree(new WideThree())), "|", show(5), "|", show(leaf(3)), "|", show(twig(3)));

function storeInAll(o: any, v: any) { o.tally = v; o.peer = v; o.girth = v; o.mate = v; }
function deleteAll(o: any) { delete o.tally; delete o.peer; delete o.girth; delete o.mate; }
// No object that the program spells out has these names: what is written of one would be written of all.
const above = JSON.parse('{ "tally": "tally above", "peer": "peer above", "girth": "girth above", "mate": "mate above" }');
const deeds: Array<(o: any) => void> = [
  o => { storeInAll(o, undefined); },
  o => { storeInAll(o, null); },
  o => { storeInAll(o, "a text"); },
  o => { storeInAll(o, 1.25); },
  o => { storeInAll(o, -2147483648); },
  o => { storeInAll(o, o); },
  o => { deleteAll(o); },
  o => { Object.setPrototypeOf(o, above); },
  o => { Object.setPrototypeOf(o, above); deleteAll(o); },
  o => { Object.setPrototypeOf(o, above); delete o.peer; delete o.girth; },
  o => { deleteAll(o); storeInAll(o, 7); },
  o => {
    Object.defineProperty(o, "tally", { get() { return "got tally"; }, configurable: true });
    Object.defineProperty(o, "peer", { get() { return "got peer"; }, configurable: true });
    Object.defineProperty(o, "girth", { get() { return "got girth"; }, configurable: true });
    Object.defineProperty(o, "mate", { get() { return "got mate"; }, configurable: true });
  },
  o => { Object.defineProperty(o, "tally", { value: "fixed", writable: false }); Object.defineProperty(o, "mate", { value: "fixed", writable: false }); },
  o => { Object.freeze(o); },
  o => { o.added = 1; o.more = 2; },
];
deeds.forEach((deed, at) => {
  const first = leaf(9);
  const second = twig(10);
  deed(first);
  deed(second);
  console.log(at, show(first), "|", show(second), "|", show(leaf(11)), "|", show(twig(12)));
});
console.log(reads);
