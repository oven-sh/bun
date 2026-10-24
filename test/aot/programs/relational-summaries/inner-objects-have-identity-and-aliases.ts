// An object that a constructor stores into a field of `this` could be laid into the parent, if it were the parent's alone. It is not: the caller still holds it, two parents share it, it is taken out and outlives the parent, it is replaced while somebody holds the old one, it is an heir with more fields, it is null, it is the parent itself.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
class Vec {
  constructor(
    public x: number,
    public y: number,
  ) {}
  length2(): number {
    return this.x * this.x + this.y * this.y;
  }
}
class Vec3 extends Vec {
  constructor(
    x: number,
    y: number,
    public z: number,
  ) {
    super(x, y);
  }
  length2(): number {
    return super.length2() + this.z * this.z;
  }
}
class Body {
  constructor(
    public position: Vec,
    public velocity: Vec,
    public tag: string,
  ) {}
  step(): void {
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;
  }
}
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const body = new Body(new Vec(i, 0), new Vec(1, 1), "warm");
  body.step();
  warm += body.position.x + body.position.y + body.velocity.length2();
}
console.log(warm);

// The caller keeps what it passed.
function callerKeeps(i: number): string {
  const position = new Vec(i, i);
  const body = new Body(position, new Vec(1, 2), "b" + i);
  position.x = -1;
  const seenThroughBody = body.position.x;
  body.step();
  return [seenThroughBody, position.x, position.y, body.position === position, body.position === body.position].join();
}
// Two parents share one child; one field twice.
function shared(i: number): string {
  const v = new Vec(1, 1);
  const a = new Body(new Vec(0, 0), v, "a");
  const b = new Body(new Vec(0, 0), v, "b");
  const twice = new Body(v, v, "twice");
  a.velocity.x = i;
  twice.step();
  return [b.velocity.x, a.velocity === b.velocity, twice.position === twice.velocity, v.x, v.y].join();
}
// The child is taken out and the parent is dropped.
function takeOut(i: number): Vec {
  return new Body(new Vec(i, i + 1), new Vec(0, 0), "dropped" + i).position;
}
// The child is replaced while somebody holds the old one.
function replaced(i: number): string {
  const body = new Body(new Vec(i, 0), new Vec(1, 0), "r");
  const old = body.position;
  body.position = new Vec(100, 100);
  body.step();
  old.y = 7;
  return [old.x, old.y, body.position.x, body.position.y, old === body.position].join();
}
// Children change places between two parents.
function exchanged(): string {
  const a = new Body(new Vec(1, 1), new Vec(0, 0), "a");
  const b = new Body(new Vec(2, 2), new Vec(0, 0), "b");
  const pa = a.position;
  [a.position, b.position] = [b.position, a.position];
  pa.x = 50;
  return [a.position.x, b.position.x, b.position === pa].join();
}
// An heir with more fields stands in the field.
function widened(i: number): string {
  const body = new Body(i % 2 ? new Vec3(1, 2, 3) : new Vec(1, 2), new Vec(0, 0), "w");
  const before = body.position.length2();
  body.position = new Vec3(0, 0, i);
  return [before, body.position.length2(), body.position instanceof Vec3, (body.position as Vec3).z].join();
}
let lines: string[] = [];
const takenOut: Vec[] = [];
for (let i = 0; i < 300; i++) {
  lines = [callerKeeps(i), shared(i), replaced(i), exchanged(), widened(i), widened(i + 1)];
  const v = takeOut(i);
  if (i % 100 === 99) takenOut.push(v);
}
console.log(lines.join(" | "));
console.log(churn(60), takenOut.map(v => v.x + "/" + v.y).join());

// Identity asked of the child: keys, sets, weak maps, freezing, extra properties.
const owners = new WeakMap<Vec, Body>();
const seen = new Set<Vec>();
function asked(i: number): string {
  const body = new Body(new Vec(i, i), new Vec(i, i), "asked" + i);
  owners.set(body.position, body);
  seen.add(body.position);
  seen.add(body.position);
  Object.freeze(body.velocity);
  let threw = false;
  try {
    body.velocity.x = 5;
  } catch {
    threw = true;
  }
  (body.position as Vec & { extra?: string }).extra = "added";
  return [owners.get(body.position) === body, owners.has(body.velocity), threw, body.velocity.x, Object.isFrozen(body), Object.isFrozen(body.position), Object.keys(body.position).join("+"), JSON.stringify(body)].join();
}
let askedLine = "";
for (let i = 0; i < 100; i++) askedLine = asked(i);
console.log(askedLine, seen.size);

// Nullable, optional, cyclic.
class TreeNode {
  parent: TreeNode | null = null;
  constructor(
    public left: TreeNode | null,
    public right: TreeNode | null,
    public n: number,
  ) {
    if (left) left.parent = this;
    if (right) right.parent = this;
  }
}
function tree(depth: number, n: number): TreeNode {
  return depth === 0 ? new TreeNode(null, null, n) : new TreeNode(tree(depth - 1, n * 2), depth % 2 ? null : tree(depth - 1, n * 2 + 1), n);
}
function sumTree(t: TreeNode | null): number {
  return t === null ? 0 : t.n + sumTree(t.left) + sumTree(t.right);
}
const root = tree(6, 1);
const selfish = new TreeNode(null, null, 0);
selfish.left = selfish;
selfish.parent = selfish;
console.log(churn(40), sumTree(root), root.left!.parent === root, root.left!.left!.parent!.parent === root, selfish.left.left!.left === selfish, selfish.parent.parent === selfish);

// The parent dies, many children live on, under young and full collections.
const survivors: Vec[] = [];
for (let i = 0; i < 5000; i++) {
  const body = new Body(new Vec(i, -i), new Vec(i, i), "mass" + i);
  if (i % 500 === 0) survivors.push(body.position, body.velocity);
}
console.log(churn(60), survivors.map(v => v.x + v.y).join());

// Literals inside literals.
interface Config {
  size: { w: number; h: number };
  name: string;
}
function makeConfig(i: number): Config {
  return { size: { w: i, h: i }, name: "config" + i };
}
function sizeOf(c: Config): { w: number; h: number } {
  return c.size;
}
const sizes: { w: number; h: number }[] = [];
let literalLine = "";
for (let i = 0; i < 300; i++) {
  const c = makeConfig(i);
  const s = sizeOf(c);
  s.w++;
  const copy = { ...c };
  copy.size.h = -1;
  if (i % 100 === 99) sizes.push(s);
  literalLine = [c.size.w, c.size.h, copy.size === c.size, s === c.size, structuredClone(c).size === c.size].join();
}
console.log(literalLine, churn(40), sizes.map(s => s.w + "/" + s.h).join());
