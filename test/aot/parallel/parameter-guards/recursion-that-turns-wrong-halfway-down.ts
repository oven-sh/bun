// A function that calls itself has proven its arguments and enters behind its guard, until halfway down what it hands itself is of another type.
class Tree {
  value = 0;
  left: Tree | null = null;
  right: Tree | null = null;
  constructor(value: number, left: Tree | null = null, right: Tree | null = null) {
    this.value = value;
    this.left = left;
    this.right = right;
  }
}
const any = (value: unknown): any => value;
function sum(tree: Tree | null): number {
  if (tree === null) return 0;
  const own = tree.value;
  return own + sum(tree.left) + sum(tree.right);
}
function depth(tree: Tree, level: number): string {
  const own = tree.value;
  const next = tree.left;
  if (!next) return level + ":" + own;
  return own + ">" + depth(next, level + 1);
}
function countDown(n: number, trail: string): string {
  if (typeof n !== "number") return trail + "[" + typeof n + " " + String(n) + "]";
  if (n <= 0) return trail + "end";
  const next: any = n === 3 ? String(n - 1) : n - 1;
  return countDown(next, trail + n + ",");
}
function even(n: number): string {
  const half = n / 2;
  return n === 0 ? "even" : odd(n === 4 ? any("3") : n - 1) + half;
}
function odd(n: number): string {
  const half = n / 2;
  return n === 0 ? "odd" : even(n - 1) + half;
}
const plain = { value: 100, left: null, right: null };
const wrongValue = { value: "text", left: null, right: null };
console.log(sum(new Tree(1, new Tree(2), new Tree(3))));
console.log(sum(new Tree(1, new Tree(2, any(plain)), new Tree(3))));
console.log(String(sum(new Tree(1, new Tree(2, any(wrongValue), new Tree(5)), new Tree(3)))));
console.log(sum(new Tree(1, new Tree(2, any(plain), any({ value: 7, left: new Tree(8), right: null })), new Tree(3))));
console.log(depth(new Tree(1, new Tree(2, new Tree(3))), 0));
console.log(depth(new Tree(1, new Tree(2, any({ value: "p", left: new Tree(4, new Tree(5)) }))), 0));
console.log(depth(new Tree(1, any({ value: 2, left: { value: 3, left: 0 } })), any("0")));
console.log(countDown(6, ""), countDown(2, ""), countDown(any("5"), ""), countDown(6, ""));
console.log(even(6), even(2), odd(5), even(any("2")));
for (const odd of [5, undefined, "text", { value: 7, left: new Tree(8), right: undefined }]) {
  try {
    console.log(String(sum(new Tree(1, new Tree(2), any(odd)))));
  } catch (error) {
    console.log("threw", (error as Error).message);
  }
}
