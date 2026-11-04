type Pine = { label: string; tag: "p"; n: number };
type Quince = { label: string; tag: "q"; n: number };
type Tree = Pine | Quince;
type Note = { pad: string; tag: string };
function rank(t: Tree): number { return t.tag === "p" ? 1 : 2; }
function probe(t: Tree, note: Note): string {
  t.label = note.tag;
  if (t.label === "p") return "p:" + t.tag;
  return "-:" + t.tag;
}
const trees: Tree[] = [], notes: Note[] = [];
for (let i = 0; i < 400; i++) {
  trees.push(i % 2 ? { label: "", tag: "p", n: i } : { label: "", tag: "q", n: i });
  notes.push(i % 3 ? { pad: "", tag: "p" } : { pad: "", tag: "z" });
}
let ranks = 0;
const seen: string[] = [];
for (let i = 0; i < 400; i++) {
  ranks += rank(trees[i]);
  const got = probe(trees[i], notes[i]);
  if (!seen.includes(got)) seen.push(got);
}
console.log(ranks, seen.sort().join(" "));
