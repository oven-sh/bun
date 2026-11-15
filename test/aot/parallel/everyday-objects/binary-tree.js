// A search tree of objects: inserted, walked in order, measured
class Tree {
  insert(key) {
    if (this.key === undefined) {
      this.key = key;
      return this;
    }
    const side = key < this.key ? "left" : "right";
    (this[side] ??= new Tree()).insert(key);
    return this;
  }
  walk(visit, depth = 0) {
    this.left?.walk(visit, depth + 1);
    visit(this.key, depth);
    this.right?.walk(visit, depth + 1);
  }
}
function show(keys) {
  const tree = keys.reduce((all, key) => all.insert(key), new Tree());
  const out = [];
  let deepest = 0;
  tree.walk((key, depth) => {
    out.push(key + "@" + depth);
    if (depth > deepest) deepest = depth;
  });
  return out.join(" ") + " " + deepest + " " + Object.keys(tree).join();
}
console.log(show([5, 2, 8, 1, 9, 3]));
console.log(show([1, 2, 3, 4]));
console.log(show([7]));
