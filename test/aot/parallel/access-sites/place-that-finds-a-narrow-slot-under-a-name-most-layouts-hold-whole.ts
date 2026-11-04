// Most classes that have these names hold them as whole values, and one class holds them in narrow slots. So a read under such a name asks as at every place, and finds the narrow slot by the one bit in which the key of the answer differs from the shape.
// The same of properties that are stored later and lie outside the cell.
let reads = 0;
enum Kind { None = 0, One = 1, Two = 2, Many = 1000 }
class Tight {
  kind: Kind = Kind.None; flags: Kind = Kind.None; girth: Kind = Kind.None; depth: Kind = Kind.None;
  share: number = 0.5;
  shut: boolean = false; done: boolean = false;
  mate: Tight | null = null; parent: Tight | null = null; left: Tight | null = null; right: Tight | null = null; last: Tight | null = null;
}
class WideOne { girth: any = "g1"; share: any = "h1"; shut: any = "s1"; mate: any = "m1"; }
class WideTwo { mate: any = "m2"; shut: any = "s2"; share: any = "h2"; girth: any = "g2"; tail: any = 0; }
class WideThree { head: any = 0; girth: any = "g3"; share: any = "h3"; shut: any = "s3"; mate: any = "m3"; }
function makeTight(i: number) {
  const tight = new Tight();
  tight.girth = (i | 0) as Kind; tight.share = i / 4; tight.shut = i % 3 === 0; tight.mate = i % 2 ? tight : null;
  return tight;
}
// Objects of two classes never meet in a variable of which the build knows more than that it holds a caught value.
function hideTight(o: Tight): any { try { throw o; } catch (caught) { return caught; } }
function hideOne(o: WideOne): any { try { throw o; } catch (caught) { return caught; } }
function hideTwo(o: WideTwo): any { try { throw o; } catch (caught) { return caught; } }
function hideThree(o: WideThree): any { try { throw o; } catch (caught) { return caught; } }
const tight = (i: number) => hideTight(makeTight(i));
function girthOf(o: any) { const v = o.girth; reads++; return v; }
function shareOf(o: any) { const v = o.share; reads++; return v; }
function shutOf(o: any) { const v = o.shut; reads++; return v; }
function mateOf(o: any) { const v = o.mate; reads++; return v; }
function noteOf(o: any) { const v = o.note; reads++; return v; }
function markOf(o: any) { const v = o.mark; reads++; return v; }
function restOf(o: any) { const v = o.rest; reads++; return v; }
function addedOf(o: any) { const v = o.added; reads++; return v; }
function countedOf(o: any) { const v = o.counted; reads++; return v; }
function weighedOf(o: any) { const v = o.weighed; reads++; return v; }
function namedOf(o: any) { const v = o.named; reads++; return v; }
function say(v: any, o: any) {
  if (v === o) return "itself";
  if (Object.is(v, -0)) return "-0";
  if (typeof v === "object" && v !== null) return "{" + v.constructor.name + "}";
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function attempt(f: () => any) { try { return f(); } catch (error: any) { return error.constructor.name; } }
function show(o: any) {
  return attempt(() => [girthOf(o), shareOf(o), shutOf(o), mateOf(o)].map(v => say(v, o)).join(" "));
}
let sum = 0;
for (let i = 0; i < 700; i++) {
  const o = tight(i);
  sum += girthOf(o) + shareOf(o) + (shutOf(o) ? 1 : 0) + (mateOf(o) === o ? 1 : 0);
}
console.log(sum);
console.log(show(tight(7)), "|", show(tight(12)), "|", show(hideOne(new WideOne())), "|", show(hideTwo(new WideTwo())), "|", show(hideThree(new WideThree())), "|", show(tight(13)));

const edges = makeTight(1);
const hiddenEdges = hideTight(edges);
edges.girth = -2147483648 as Kind;
edges.share = -0;
console.log(show(hiddenEdges));
edges.girth = 2147483647 as Kind;
edges.share = NaN;
console.log(show(hiddenEdges));
edges.share = Infinity;
console.log(show(hiddenEdges));

function storeInAll(o: any, v: any) { o.girth = v; o.share = v; o.shut = v; o.mate = v; }
function deleteAll(o: any) { delete o.girth; delete o.share; delete o.shut; delete o.mate; }
// No object that the program spells out has these names: what is written of one would be written of all.
const above = JSON.parse('{ "girth": "girth above", "share": "share above", "shut": "shut above", "mate": "mate above" }');
const deeds: Array<(o: any) => void> = [
  o => { storeInAll(o, undefined); },
  o => { storeInAll(o, null); },
  o => { storeInAll(o, "a text"); },
  o => { storeInAll(o, 1.25); },
  o => { storeInAll(o, o); },
  o => { deleteAll(o); },
  o => { Object.setPrototypeOf(o, above); deleteAll(o); },
  o => { Object.setPrototypeOf(o, above); delete o.share; delete o.shut; },
  o => {
    Object.defineProperty(o, "girth", { get() { return "got girth"; }, configurable: true });
    Object.defineProperty(o, "share", { get() { return "got share"; }, configurable: true });
    Object.defineProperty(o, "shut", { get() { return "got shut"; }, configurable: true });
    Object.defineProperty(o, "mate", { get() { return "got mate"; }, configurable: true });
  },
  o => { Object.freeze(o); },
];
deeds.forEach((deed, at) => {
  const o = tight(9);
  deed(o);
  console.log(at, show(o), "|", show(tight(9)));
});

// Stored later, by some of the code that meets the object: the slots lie outside the cell. Two classes have the names.
class Grown {
  first = 1;
  note?: any;
  mark?: any;
  rest?: any;
}
class Sprout {
  rest?: any;
  mark?: any;
  note?: any;
  first = 2;
  second = 3;
}
function grow(i: number) {
  const grown = new Grown();
  grown.first = i;
  if (i % 2) grown.note = "note " + i;
  if (i % 3) grown.mark = i * 2;
  if (i % 5 === 0) grown.rest = grown;
  return grown;
}
function sprout(i: number) {
  const made = new Sprout();
  made.first = -i;
  if (i % 3) made.note = "sprout's note " + i;
  if (i % 2) made.mark = i * 3;
  return made;
}
function hideGrown(o: Grown): any { try { throw o; } catch (caught) { return caught; } }
function hideSprout(o: Sprout): any { try { throw o; } catch (caught) { return caught; } }
function later(o: Grown, i: number) { (o as any).added = "added " + i; (o as any).counted = i; (o as any).weighed = i / 2; (o as any).named = "n" + i; return o; }
function laterToo(o: Sprout, i: number) { (o as any).named = "s" + i; (o as any).weighed = i / 4; (o as any).counted = -i; (o as any).added = "sprout's " + i; return o; }
function showGrown(o: any) {
  return attempt(() => [noteOf(o), markOf(o), restOf(o), addedOf(o), countedOf(o), weighedOf(o), namedOf(o)].map(v => say(v, o)).join(" "));
}
let lines = "";
for (let i = 0; i < 900; i++) {
  const line = showGrown(hideGrown(i % 4 ? later(grow(i), i) : grow(i)));
  if (i % 97 === 0) lines += line + "\n";
}
console.log(lines);
console.log(showGrown(hideSprout(laterToo(sprout(7), 7))), "|", showGrown(hideSprout(sprout(8))), "|", showGrown(hideGrown(later(grow(7), 7))));
const grownAbove = JSON.parse('{ "added": "added above", "note": "note above", "mark": "mark above", "counted": "counted above", "weighed": "weighed above" }');
const grownDeeds: Array<(o: any) => void> = [
  o => { delete o.added; delete o.note; delete o.counted; },
  o => { Object.setPrototypeOf(o, grownAbove); delete o.added; delete o.note; delete o.mark; delete o.counted; delete o.weighed; },
  o => { Object.setPrototypeOf(o, grownAbove); },
  o => { o.added = undefined; o.note = null; o.counted = undefined; o.weighed = null; },
  o => { o.counted = "a text"; o.weighed = o; o.named = 5; },
  o => { Object.defineProperty(o, "added", { get() { return "got"; }, configurable: true }); Object.defineProperty(o, "counted", { get() { return "got too"; }, configurable: true }); },
  o => { Object.freeze(o); },
];
grownDeeds.forEach((deed, at) => {
  const grown = hideGrown(later(grow(15), 15));
  deed(grown);
  const bare = hideGrown(grow(16));
  deed(bare);
  console.log(at, showGrown(grown), "|", showGrown(hideGrown(later(grow(15), 15))), "|", showGrown(bare));
});
console.log(sum, reads);
