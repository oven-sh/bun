// Methods of one name that return 32-bit integers in one class, larger ones in another and fractions in a third.
interface Node { value(x: number): number; depth(): number; size(): number }
class Leaf implements Node { constructor(private held: number) {} value(): number { return this.held; } depth(): number { return 1; } size(): number { return 0.5; } }
class Name implements Node { value(x: number): number { return x; } depth(): number { return 0; } size(): number { return 2; } }
class Sum implements Node { constructor(private left: Node, private right: Node) {} value(x: number): number { return this.left.value(x) + this.right.value(x); } depth(): number { return Math.max(this.left.depth(), this.right.depth()) + 1; } size(): number { return this.left.size() + this.right.size(); } }
class Product implements Node { constructor(private left: Node, private right: Node) {} value(x: number): number { return this.left.value(x) * this.right.value(x); } depth(): number { return Math.max(this.left.depth(), this.right.depth()) + 1; } size(): number { return this.left.size() * this.right.size(); } }
class Word implements Node { constructor(private text: string) {} value(): number { return this.text.length; } depth(): number { return this.text.length >>> 0; } size(): number { return (this.text.length - 9) >>> 0; } }
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v);
const trees: Node[] = [new Sum(new Product(new Name(), new Sum(new Name(), new Leaf(2))), new Word("four")), new Product(new Leaf(-0), new Name()), new Sum(new Leaf(2147483647), new Leaf(1)), new Product(new Word("twelve chars"), new Leaf(0.1)), new Leaf(NaN), new Word("ab"), new Name()];
for (const tree of trees) {
  const list: number[] = [], words = new Int32Array(3), map = new Map<number, string>();
  for (const x of [0, -0, 3, -7, 2147483647, -2147483648, 4294967296, 1.5, NaN, Infinity]) {
    const value = tree.value(x), depth = tree.depth(), size = tree.size();
    list.push(value); words[0] = value; map.set(depth, "depth"); map.set(size, "size");
    console.log([value, depth, size, words[0], value | 0, depth % 3, 1 / depth, `${size}`, list[depth], value === depth, map.get(1), map.get(2)].map(show).join(" "));
  }
}
class First { count(): number { return 3; } at(i: number): number { return i; } }
class Second extends First { override count(): number { return 2.5; } override at(i: number): number { return super.at(i) / 2; } }
class Third extends Second { override count(): number { return super.count() | 0; } override at(i: number): number { return i > 0 ? this.at(i - 1) + 1 : 0; } }
for (const held of [new First(), new Second(), new Third()]) {
  const { count } = held, keys = "abcdefgh";
  console.log(show(held.count()), show(held.at(5)), show(keys[held.count()]), show(keys[held.at(4)]), show(count()), show(held["count"]()), JSON.stringify([held.at(6), held.count()]), held.count() === 2, typeof held.at(1));
  switch (held.count()) { case 2: console.log("two"); break; case 2.5: console.log("two and a half"); break; case 3: console.log("three"); }
  let sum = 0; for (let i = held.count(); i < 6; i++) sum += held.at(i); console.log(show(sum));
}
const own: Node = { value: x => x * 2, depth: () => -0, size: () => 7 };
for (const node of [own, trees[0]!, trees[4]!]) console.log(show(node.value(3)), show(node.depth()), show(node.size()));
const changed: any = new Leaf(4); changed.depth = () => "text";
for (const node of [changed, trees[5]!]) console.log(show(node.depth()), show(node.value(1)));
