// A store needs no write barrier while its target is as young as can be. "The target is fresh" ends at the first collection: the callee that made it ran one, an argument's evaluation ran one, a field initializer allocates enough to cause one, or the helper that stores is now and then handed an object that has grown old. Each child is read back after young collections that only a barrier could have told about it.
import { edenGC, fullGC } from "bun:jsc";
interface Child {
  n: number;
  text: string;
}
interface Parent {
  tag: string;
  child: Child | null;
  list: Child[];
  read: (() => number) | null;
}
function garbage(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += [i, i + 1, { i }].length + ("g" + i).length;
  return sum;
}
const child = (n: number): Child => ({ n, text: "child " + n });
function makeParent(tag: string, collect: boolean): Parent {
  const made: Parent = { tag, child: null, list: [], read: null };
  if (collect) fullGC();
  return made;
}
function setChild(p: Parent, c: Child): void {
  p.child = c;
}
function pushChild(p: Parent, c: Child): void {
  p.list.push(c);
}
function setElement(p: Parent, at: number, c: Child): void {
  p.list[at] = c;
}
function setReader(p: Parent, c: Child): void {
  p.read = () => c.n;
}
function check(p: Parent, n: number): boolean {
  return p.child!.n === n && p.child!.text === "child " + n;
}
let good = 0;

// The maker collects before it returns: its result is fresh and already old.
for (let i = 0; i < 60; i++) {
  const p = makeParent("made" + i, i % 10 === 9);
  p.child = child(i);
  edenGC();
  garbage(200);
  if (check(p, i)) good++;
}
console.log(good);

// The collection stands between the allocation and the store, in the caller.
good = 0;
for (let i = 0; i < 40; i++) {
  const p: Parent = { tag: "local" + i, child: null, list: [], read: null };
  if (i % 4 === 3) fullGC();
  setChild(p, child(i));
  pushChild(p, child(i + 1));
  setReader(p, child(i + 2));
  edenGC();
  garbage(200);
  edenGC();
  if (check(p, i) && p.list[0].n === i + 1 && p.read!() === i + 2) good++;
}
console.log(good);

// The operand's own evaluation collects: `new Node(expensive(), expensive())`, and a literal whose later members collect.
class Node2 {
  constructor(
    public left: Child,
    public right: Child,
  ) {}
}
function expensive(n: number): Child {
  const made = child(n);
  if (n % 5 === 4) fullGC();
  return made;
}
good = 0;
for (let i = 0; i < 50; i++) {
  const node = new Node2(expensive(i), expensive(i + 1));
  const literal = { first: child(i), second: expensive(i + 2), third: child(i + 3) };
  const list = [child(i), expensive(i + 3), child(i + 5)];
  edenGC();
  garbage(100);
  if (node.left.n === i && node.right.text === "child " + (i + 1) && literal.first.n === i && literal.third.text === "child " + (i + 3) && list[0].n === i && list[2].n === i + 5) good++;
}
console.log(good);

// A constructor: the base collects, then the heir stores; field initializers allocate between stores.
class Base {
  constructor(collect: boolean) {
    if (collect) fullGC();
  }
}
class Heir extends Base {
  a = child(1);
  filler = garbage(50);
  b = child(2);
  c: Child;
  constructor(n: number) {
    super(n % 6 === 5);
    this.c = child(n);
  }
}
good = 0;
for (let i = 0; i < 60; i++) {
  const h = new Heir(i);
  edenGC();
  garbage(100);
  if (h.a.n === 1 && h.b.text === "child 2" && h.c.n === i) good++;
}
console.log(good);

// The helper is nearly always handed a parent that was just made, and now and then one that is old.
const old: Parent[] = [];
for (let i = 0; i < 8; i++) old.push(makeParent("old" + i, false));
fullGC();
fullGC();
good = 0;
for (let i = 0; i < 400; i++) {
  const p = i % 50 === 49 ? old[(i / 50) | 0] : makeParent("young" + i, false);
  setChild(p, child(i));
  pushChild(p, child(i));
  setElement(p, 1, child(-i));
  setReader(p, child(i * 2));
  if (i % 50 === 49) {
    edenGC();
    garbage(300);
    edenGC();
  }
}
garbage(3000);
edenGC();
for (let k = 0; k < 8; k++) {
  const n = k * 50 + 49;
  if (check(old[k], n) && old[k].list[0].n === n && old[k].list[1].n === -n && old[k].read!() === n * 2) good++;
}
console.log(good);

// A variable of an old scope is stored to by a closure that a helper calls.
function makeCell() {
  let held: Child | null = null;
  return { set: (c: Child) => void (held = c), get: () => held };
}
function callWith(f: (c: Child) => void, c: Child): void {
  f(c);
}
const cells = [makeCell(), makeCell(), makeCell()];
fullGC();
good = 0;
for (let i = 0; i < 90; i++) {
  callWith(cells[i % 3].set, child(i));
  if (i % 30 === 29) {
    edenGC();
    garbage(300);
    edenGC();
    for (let k = 0; k < 3; k++) if (cells[k].get()!.text === "child " + (i - 2 + k)) good++;
  }
}
console.log(good);

// Containers that have grown old: a map, a set, an array that is filled, spliced and copied within.
const oldMap = new Map<number, Child>();
const oldSet = new Set<Child>();
const oldList: (Child | null)[] = new Array(16).fill(null);
const oldHolder: { pair: [Child | null, Child | null] } = { pair: [null, null] };
fullGC();
function fillAll(i: number): void {
  oldMap.set(i % 4, child(i));
  oldSet.add(child(i));
  oldList.fill(child(i), i % 16, (i % 16) + 1);
  oldList.splice(0, 1, child(-i));
  oldHolder.pair = [child(i), child(i + 1)];
  oldHolder.pair[1] = child(i + 2);
}
for (let i = 0; i < 64; i++) {
  fillAll(i);
  if (i % 16 === 15) {
    edenGC();
    garbage(200);
  }
}
edenGC();
garbage(2000);
edenGC();
console.log([...oldMap.values()].map(c => c.text).join(), oldSet.size, [...oldSet][63].text, oldList.map(c => c!.n).join(), oldHolder.pair.map(c => c!.text).join());
