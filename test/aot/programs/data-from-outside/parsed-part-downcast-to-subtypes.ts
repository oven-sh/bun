// A part of parsed JSON is cast from its base type to one of two subtypes, read, stored to, and put into a literal and an array of the program. Any object passes a cast, a parameter and a field of an object type; a number throws there. A missing field reads undefined, and a field of another kind throws at its first typed read.
interface Base { kind: number }
interface Leaf extends Base { text: string; size: number }
interface Pair extends Base { left: Base; right: Base }
interface Info { version: string; root: Base }
function showLeaf(leaf: Leaf): string { return String(leaf.kind) + "|" + String(leaf.text) + "|" + String(leaf.size) + "|" + Object.keys(leaf).join(","); }
function showPair(pair: Pair): string { return String(pair.kind) + "|" + String(pair.left && pair.left.kind) + "|" + String(pair.right && pair.right.kind); }
function show(base: Base): string { return base.kind === 1 ? showLeaf(base as Leaf) : base.kind === 2 ? showPair(base as Pair) : "other " + String(base.kind); }
function grow(leaf: Leaf): string { leaf.size = 9; leaf.text = leaf.text + "!"; return showLeaf(leaf); }
function attempt(label: string, run: () => string): void {
  try { console.log(label + " " + run()); } catch (error) { console.log(label + " threw " + (error as Error).constructor.name); }
}
const leaf: Leaf = { kind: 1, text: "t", size: 1 };
const pair: Pair = { kind: 2, left: leaf, right: { kind: 1, text: "u", size: 2 } as Leaf };
const texts: string[] = [
  '{"version":"1","root":{"kind":1,"text":"a","size":3}}',
  '{"version":"1","root":{"size":3,"text":"a","kind":1}}',
  '{"version":"1","root":{"kind":1}}',
  '{"version":"1","root":{"kind":1,"text":5,"size":"big"}}',
  '{"version":"1","root":{"kind":1,"text":"a","size":3,"more":true}}',
  '{"version":"1","root":{"kind":2,"left":{"kind":1,"text":"l","size":1},"right":{"kind":3}}}',
  '{"version":"1","root":{"kind":2}}',
  '{"version":"1","root":{"kind":2,"left":7,"right":null}}',
  '{"version":"1","root":{"kind":3}}',
  '{"version":"1","root":[]}', '{"version":"1","root":7}', '{"version":"1"}', '{"version":"1","root":null}',
];
attempt("made", () => show(leaf) + " & " + show(pair));
for (const text of texts) {
  attempt("shown", () => show((JSON.parse(text) as Info).root));
  attempt("leaf", () => showLeaf((JSON.parse(text) as Info).root as Leaf));
  attempt("grown", () => grow((JSON.parse(text) as Info).root as Leaf));
  attempt("paired", () => { const both: Pair = { kind: 2, left: leaf, right: (JSON.parse(text) as Info).root }; return show(both) + " & " + show(both.right); });
  attempt("listed", () => { const leaves: Leaf[] = [leaf, (JSON.parse(text) as Info).root as Leaf]; return leaves.map(showLeaf).join(" & "); });
}
attempt("made again", () => grow(leaf) + " & " + show(pair));
