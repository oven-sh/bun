// In a cycle of calls the answer about a parameter depends on itself: parameters change places from call to call, the base case keeps, returns or links what came down, and a result is fresh on some ways round the cycle and a parameter on others.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Link {
  key: number;
  tag: string;
  next: Link | null;
}
const link = (key: number, tag: string, next: Link | null = null): Link => ({ key, tag, next });
function find(from: Link | null, key: number): Link | null {
  return from === null ? null : from.key === key ? from : find(from.next, key);
}
function changePlaces(a: Link, b: Link, n: number): Link {
  return n === 0 ? a : changePlaces(b, a, n - 1);
}
function rotate(a: Link, b: Link, c: Link, n: number): Link {
  return n === 0 ? a : rotate(b, c, a, n - 1);
}
function linkAtTheBottom(a: Link, b: Link, n: number): void {
  if (n === 0) a.next = b;
  else linkAtTheBottom(b, a, n - 1);
}
const keptAtTheBottom: Link[] = [];
function even(a: Link, n: number): number {
  return n === 0 ? a.key : odd(a, n - 1);
}
function odd(a: Link, n: number): number {
  if (n === 0) {
    keptAtTheBottom.push(a);
    return -a.key;
  }
  return even(a, n - 1);
}
function build(n: number): Link {
  return n === 0 ? link(0, "bottom") : link(n, "built" + n, build(n - 1));
}
function freshOrSpare(n: number, spare: Link): Link {
  if (n === 0) return spare;
  if (n === 1) return link(1, "fresh at one");
  return freshOrSpare(n - 2, spare);
}
function ping(n: number, carried: Link): Link {
  return n === 0 ? carried : pong(n - 1, carried);
}
function pong(n: number, carried: Link): Link {
  return n % 3 === 0 ? ping(n, link(n, "made in pong at " + n)) : ping(n - 1 < 0 ? 0 : n - 1, carried);
}
const lines: string[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const a = link(1, "a" + i);
  const b = link(2, "b" + i);
  const c = link(3, "c" + i, link(4, "d" + i, link(5, "e" + i)));
  const found = find(c, 5)!;
  const line = [
    found === c.next!.next,
    find(c, 9),
    changePlaces(a, b, i % 4) === (i % 2 ? b : a),
    rotate(a, b, c, i % 5) === [a, b, c][(i % 5) % 3],
    freshOrSpare(i % 6, a) === a,
    freshOrSpare(i % 6, a).tag,
    ping(i % 7, b) === b,
    ping(i % 7, b).tag,
  ].join();
  linkAtTheBottom(a, b, i % 3);
  sum += even(link(i, "went down " + i), i % 100 === 99 ? 5 : 4) + build(i % 5).key;
  if (i >= 294) lines.push(line + " " + (a.next === b) + " " + (b.next === a));
}
console.log(sum, churn(60));
console.log(lines.join("\n"));
console.log(keptAtTheBottom.map(n => n.tag).join());
let chain: Link | null = build(4);
let tags = "";
for (; chain; chain = chain.next) tags += chain.tag + " ";
console.log(tags);

// A tree walk through a callback that calls the walk again.
interface Tree {
  name: string;
  kids: Tree[];
}
function walk(tree: Tree, visit: (t: Tree, depth: number) => void, depth = 0): void {
  visit(tree, depth);
  tree.kids.forEach(kid => walk(kid, visit, depth + 1));
}
const leaf = (name: string): Tree => ({ name, kids: [] });
const deepest: Tree[] = [];
let visits = 0;
for (let i = 0; i < 150; i++) {
  walk({ name: "root" + i, kids: [leaf("x" + i), { name: "y" + i, kids: [leaf("z" + i)] }] }, (t, depth) => {
    visits++;
    if (depth === 2 && i % 70 === 69) deepest.push(t);
  });
}
console.log(visits, churn(60), deepest.map(t => t.name).join());

// A function that is handed itself.
type Self = (self: Self, n: number, carried: { tag: string }) => { tag: string };
const viaItself: Self = (self, n, carried) => (n === 0 ? carried : self(self, n - 1, n === 2 ? { tag: carried.tag + "+" } : carried));
let results = "";
for (let i = 0; i < 100; i++) {
  const carried = { tag: "carried" + i };
  const back = viaItself(viaItself, i % 4, carried);
  if (i >= 96) results += back.tag + ":" + (back === carried) + " ";
}
console.log(results);
