// Generator methods of a class: trees walked by yield*
class Tree {
  constructor(value, ...kids) {
    this.value = value;
    this.kids = kids;
  }
  *[Symbol.iterator]() {
    yield this.value;
    for (const kid of this.kids) yield* kid;
  }
  *leaves(depth = 0) {
    if (!this.kids.length) yield [this.value, depth];
    for (const kid of this.kids) yield* kid.leaves(depth + 1);
  }
}
function show(a, b) {
  const tree = new Tree(a, new Tree(b, new Tree(a + b)), new Tree(b * 2));
  return [...tree].join() + " " + [...tree.leaves()].map(leaf => leaf.join("@")).join() + " " + Array.from(tree, n => n * 10).pop();
}
console.log(show(1, 2));
console.log(show(50, 5));
console.log(show(0, -3));
