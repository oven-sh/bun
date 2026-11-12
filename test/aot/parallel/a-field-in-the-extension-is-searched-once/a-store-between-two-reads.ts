// A field that is laid behind the maker lies in the extension. Where the prototype may get the name at run time, a read asks "is the slot filled?" and then reads: both take one search. A store by the same name, by another name and in a callee stands between two such reads.
interface Leaf { flags: number; id: number; }
interface Branch extends Leaf { weight: number; next: Leaf; depth: number; width: number; origin: Leaf; mark: number; }
function Leaf(this: Leaf, flags: number, id: number) { this.flags = flags; this.id = id; }
function put(o: any, k: string, v: any) { o[k] = v; }
put((Leaf as any).prototype, process.argv.length > 5 ? "mark" : "other", 1);
function makeLeaf(i: number): Leaf { return new (Leaf as any)(i & 3, i); }
function makeBranch(i: number): Branch {
  const branch = new (Leaf as any)(4 | (i & 3), i) as Branch;
  branch.weight = i;
  branch.next = branch;
  branch.depth = i + 1;
  branch.width = i + 2;
  branch.origin = branch;
  branch.mark = i * 2;
  return branch;
}
function markOf(leaf: Leaf): number { return leaf.flags & 4 ? (leaf as Branch).mark : 0; }
function isOwnOrigin(leaf: Leaf): boolean { return !!(leaf.flags & 4) && (leaf as Branch).origin === leaf; }
function readStoreRead(leaf: Leaf, value: number, stores: boolean): number {
  const first = markOf(leaf);
  if (stores) (leaf as Branch).mark = value;
  return first * 1000 + markOf(leaf);
}
function readStoreThroughAnotherNameRead(leaf: Leaf, other: Leaf, value: number): number {
  const first = markOf(leaf);
  (other as Branch).mark = value;
  return first * 1000 + markOf(leaf);
}
function set(leaf: Leaf, value: number) { (leaf as Branch).mark = value; }
function readCallRead(leaf: Leaf, turn: number): number {
  const first = markOf(leaf);
  if (turn & 1) set(leaf, 5);
  return first * 1000 + markOf(leaf);
}
let sum = 0, own = 0;
for (let turn = 0; turn < 4096; turn++) {
  const leaf = turn & 8 ? makeLeaf(turn) : makeBranch(turn), other = makeBranch(turn + 64);
  if (isOwnOrigin(leaf)) own++;
  sum = (sum + markOf(leaf)) % 1000003;
  if (leaf.flags & 4) {
    sum = (sum + readStoreRead(leaf, turn & 15, (turn & 3) === 0)) % 1000003;
    sum = (sum + readStoreThroughAnotherNameRead(leaf, (turn & 7) === 0 ? leaf : other, 3)) % 1000003;
    sum = (sum + readCallRead(leaf, turn)) % 1000003;
  }
}
console.log(own, sum);
