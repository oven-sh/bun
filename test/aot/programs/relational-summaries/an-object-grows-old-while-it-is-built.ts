// An object is as young as can be only until the next allocation: the allocation of its own first child may run a collection, and from then on every store into it is a store of a young object into an old one. Constructors, literals filled behind their allocation, objects that outgrow their cells, one barrier for many stores: each shape is built in a loop, collections fall where they fall (and where the options of the collector put them), an eden collection follows, and every child is read.
import { edenGC, fullGC } from "bun:jsc";
interface Leaf {
  n: number;
  text: string;
}
const leaf = (n: number): Leaf => ({ n, text: "leaf " + n });
const isLeaf = (l: Leaf | undefined | null, n: number): boolean => !!l && l.n === n && l.text === "leaf " + n;
function garbage(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += [i, i + 1, { i }].length + ("g" + i).length;
  return sum;
}
class Three {
  a: Leaf;
  b: Leaf;
  c: Leaf;
  constructor(n: number) {
    this.a = { n, text: "leaf " + n };
    this.b = { n: n + 1, text: "leaf " + (n + 1) };
    this.c = { n: n + 2, text: "leaf " + (n + 2) };
  }
  holds(n: number): boolean {
    return isLeaf(this.a, n) && isLeaf(this.b, n + 1) && isLeaf(this.c, n + 2);
  }
}
class ThreeWithACollection {
  a: Leaf;
  b: Leaf;
  c: Leaf;
  constructor(n: number, where: number) {
    if (where === 0) fullGC();
    this.a = { n, text: "leaf " + n };
    if (where === 1) fullGC();
    this.b = { n: n + 1, text: "leaf " + (n + 1) };
    if (where === 2) fullGC();
    this.c = { n: n + 2, text: "leaf " + (n + 2) };
    if (where === 3) fullGC();
  }
  holds(n: number): boolean {
    return isLeaf(this.a, n) && isLeaf(this.b, n + 1) && isLeaf(this.c, n + 2);
  }
}
class FieldsWithInitializers {
  a: Leaf = leaf(this.start());
  list: Leaf[] = [leaf(this.start() + 1)];
  read: () => Leaf = () => this.a;
  b: Leaf = leaf(this.start() + 2);
  static next = 0;
  start(): number {
    return FieldsWithInitializers.next;
  }
  holds(n: number): boolean {
    return isLeaf(this.a, n) && isLeaf(this.list[0], n + 1) && isLeaf(this.b, n + 2) && this.read() === this.a;
  }
}
class Parent {
  first: Leaf;
  constructor(n: number) {
    this.first = leaf(n);
  }
}
class Heir extends Parent {
  second: Leaf;
  third: Leaf = leaf(-3);
  constructor(n: number, collect: boolean) {
    super(n);
    if (collect) fullGC();
    this.second = leaf(n + 1);
    this.third = leaf(n + 2);
  }
  holds(n: number): boolean {
    return isLeaf(this.first, n) && isLeaf(this.second, n + 1) && isLeaf(this.third, n + 2);
  }
}
// More names than a cell has room for: the stores make room as they go.
function outgrowsItsCell(n: number, collectAt: number): Record<string, Leaf> {
  const o: Record<string, Leaf> = {};
  o.f0 = leaf(n);
  o.f1 = leaf(n + 1);
  o.f2 = leaf(n + 2);
  o.f3 = leaf(n + 3);
  if (collectAt === 1) fullGC();
  o.f4 = leaf(n + 4);
  o.f5 = leaf(n + 5);
  o.f6 = leaf(n + 6);
  o.f7 = leaf(n + 7);
  o.f8 = leaf(n + 8);
  if (collectAt === 2) fullGC();
  o.f9 = leaf(n + 9);
  o.f10 = leaf(n + 10);
  o.f11 = leaf(n + 11);
  o.f12 = leaf(n + 12);
  o.f13 = leaf(n + 13);
  return o;
}
function childrenFirstThenTheStores(n: number, collect: boolean): { a?: Leaf; b?: Leaf; c?: Leaf } {
  const o: { a?: Leaf; b?: Leaf; c?: Leaf } = {};
  if (collect) fullGC();
  const a = leaf(n);
  const b = leaf(n + 1);
  const c = leaf(n + 2);
  o.a = a;
  o.b = b;
  o.c = c;
  return o;
}
function literalWhoseValuesAllocate(n: number): { a: Leaf; b: Leaf[]; c: { d: Leaf }; e: string } {
  return { a: leaf(n), b: [leaf(n + 1), leaf(n + 2)], c: { d: leaf(n + 3) }, e: "e" + n };
}
function arrayThatGrows(n: number, collectAt: number): Leaf[] {
  const list: Leaf[] = [];
  for (let i = 0; i < 20; i++) {
    if (i === collectAt) fullGC();
    list.push(leaf(n + i));
  }
  return list;
}
function arrayFilledByIndex(n: number, collectAt: number): Leaf[] {
  const list = new Array<Leaf>(12);
  for (let i = 0; i < 12; i++) {
    if (i === collectAt) fullGC();
    list[i] = leaf(n + i);
  }
  return list;
}
function closureOverWhatComesLater(n: number, collect: boolean): () => Leaf {
  let held: Leaf = leaf(-1);
  const read = () => held;
  if (collect) fullGC();
  held = leaf(n);
  return read;
}
function mapAndSet(n: number, collect: boolean): [Map<number, Leaf>, Set<Leaf>] {
  const map = new Map<number, Leaf>();
  const set = new Set<Leaf>();
  if (collect) fullGC();
  for (let i = 0; i < 6; i++) {
    map.set(i, leaf(n + i));
    set.add(leaf(n + i));
  }
  return [map, set];
}
const wrong: string[] = [];
const expect = (holds: boolean, what: string, i: number): void => {
  if (!holds && wrong.length < 20) wrong.push(what + " " + i);
};
let rounds = 0;
for (let i = 0; i < 1500; i++) {
  const rare = i % 50 === 49;
  const three = new Three(i);
  const withCollection = new ThreeWithACollection(i, rare ? (i / 50) & 3 : 9);
  FieldsWithInitializers.next = i;
  const fields = new FieldsWithInitializers();
  const heir = new Heir(i, rare);
  const big = outgrowsItsCell(i, rare ? 1 + ((i / 50) & 1) : 0);
  const late = childrenFirstThenTheStores(i, rare);
  const literal = literalWhoseValuesAllocate(i);
  const grown = arrayThatGrows(i, rare ? i % 20 : -1);
  const filled = arrayFilledByIndex(i, rare ? i % 12 : -1);
  const read = closureOverWhatComesLater(i, rare);
  const [map, set] = mapAndSet(i, rare);
  if (i % 10 === 9) {
    edenGC();
    garbage(100);
  }
  expect(three.holds(i), "three", i);
  expect(withCollection.holds(i), "three with a collection", i);
  expect(fields.holds(i), "fields", i);
  expect(heir.holds(i), "heir", i);
  for (let k = 0; k < 14; k++) expect(isLeaf(big["f" + k], i + k), "f" + k, i);
  expect(isLeaf(late.a, i) && isLeaf(late.b, i + 1) && isLeaf(late.c, i + 2), "children first", i);
  expect(isLeaf(literal.a, i) && isLeaf(literal.b[0], i + 1) && isLeaf(literal.b[1], i + 2) && isLeaf(literal.c.d, i + 3) && literal.e === "e" + i, "literal", i);
  for (let k = 0; k < 20; k++) expect(isLeaf(grown[k], i + k), "grown " + k, i);
  for (let k = 0; k < 12; k++) expect(isLeaf(filled[k], i + k), "filled " + k, i);
  expect(isLeaf(read(), i), "closure", i);
  let k = 0;
  for (const l of set) expect(isLeaf(l, i + k) && isLeaf(map.get(k), i + k++), "map and set", i);
  rounds++;
}
console.log(rounds, wrong.length ? "WRONG: " + wrong.join(", ") : "every child is there");

// Old owners that are built further, a little in each round, with an eden collection behind each step.
const slow: { three: Partial<Three>; big: Record<string, Leaf>; list: Leaf[] }[] = [];
for (let i = 0; i < 40; i++) slow.push({ three: {}, big: {}, list: [] });
fullGC();
for (let step = 0; step < 12; step++) {
  for (let i = 0; i < slow.length; i++) {
    const s = slow[i];
    if (step === 0) s.three.a = leaf(i);
    if (step === 1) s.three.b = leaf(i + 1);
    if (step === 2) s.three.c = leaf(i + 2);
    s.big["k" + step] = leaf(i + step);
    s.list.push(leaf(i + step));
  }
  edenGC();
  garbage(300);
}
let good = 0;
for (let i = 0; i < slow.length; i++) {
  const s = slow[i];
  let all = isLeaf(s.three.a, i) && isLeaf(s.three.b, i + 1) && isLeaf(s.three.c, i + 2);
  for (let step = 0; step < 12; step++) all &&= isLeaf(s.big["k" + step], i + step) && isLeaf(s.list[step], i + step);
  if (all) good++;
}
console.log(good, "of", slow.length);
