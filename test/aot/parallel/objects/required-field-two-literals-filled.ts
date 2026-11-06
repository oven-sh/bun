// Two literals make objects of one type. One leaves a required field out, and its objects never come to the function that fills the field where it is missing and returns it.
interface LeafA { kind: "a"; x: number }
interface LeafB { kind: "b"; y: number }
type Leaf = LeafA | LeafB;
interface Holder { id: number; leaf: Leaf }
function makeFull(id: number): Holder {
  return { id, leaf: id % 2 ? { kind: "a", x: id } : { kind: "b", y: id } };
}
function makeBare(id: number): Holder {
  return { id } as Holder;
}
function replace(holder: Holder) {
  holder.leaf = holder.id % 3 ? { kind: "a", x: 1 } : { kind: "b", y: 2 };
}
function leafOf(holder: Holder, depth = 3): Leaf {
  if (depth > 0) return leafOf(holder, depth - 1);
  holder.leaf ??= { kind: "b", y: 0 };
  return holder.leaf;
}
const full: Holder[] = [];
const bare: Holder[] = [];
for (let id = 0; id < 10; id++) {
  full.push(makeFull(id));
  bare.push(makeBare(id));
}
let total = 0;
for (const holder of full) {
  const leaf = leafOf(holder);
  total += leaf.kind === "a" ? leaf.x : leaf.y;
}
for (const holder of bare) total += holder.id;
for (const holder of full) replace(holder);
for (const holder of full) total += leafOf(holder).kind.length;
console.log(total, [leafOf].map(read => read(full[3]).kind).join());
