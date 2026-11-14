// A field holds instances of two classes, null, undefined or text: its shape is asked of the word that is stored, in loops and behind them.
class Name {
  constructor(text) {
    this.text = text;
  }
  compareTo(other) {
    return this.text < other.text ? -1 : this.text > other.text ? 1 : 0;
  }
}
class Place {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  compareTo(other) {
    return this.x - other.x || this.y - other.y;
  }
}
class Node {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.left = null;
    this.right = null;
    this.parent = undefined;
  }
}
class Tree {
  constructor() {
    this.root = null;
  }
  put(key, value) {
    let above = null;
    let node = this.root;
    while (node) {
      above = node;
      const order = key.compareTo(node.key);
      if (order < 0) node = node.left;
      else if (order > 0) node = node.right;
      else {
        const old = node.value;
        node.value = value;
        return old;
      }
    }
    const added = new Node(key, value);
    added.parent = above;
    if (!above) this.root = added;
    else if (key.compareTo(above.key) < 0) above.left = added;
    else above.right = added;
    return null;
  }
  kinds() {
    let names = 0, places = 0, nodes = 0, others = 0;
    const visit = node => {
      if (!node) return;
      const value = node.value;
      if (value instanceof Name) names += value.text.length;
      else if (value instanceof Place) places += value.x;
      else if (value instanceof Node) nodes += value.key === node.key ? 1 : 100;
      else others += value === null ? 1 : value === undefined ? 10 : value === "text" ? 100 : 1000;
      visit(node.left);
      visit(node.right);
    };
    visit(this.root);
    return [names, places, nodes, others].join();
  }
}
function run(k) {
  const byName = new Tree(), byPlace = new Tree(), out = [];
  let replaced = 0, thrown = 0;
  for (let i = 0; i < k; i++) {
    const name = new Name("n" + ((i * 37) % 101)), place = new Place((i * 13) % 17, (i * 7) % 11);
    const value = i % 7 === 0 ? name : i % 7 === 1 ? place : i % 7 === 2 ? null : i % 7 === 3 ? undefined : i % 7 === 4 ? "text" : i % 7 === 5 ? byName.root : place;
    const old = byName.put(name, value);
    if (old) replaced += old.text ? old.text.length : old.x ? old.x : old.length || 1;
    if (byPlace.put(place, name)) replaced++;
  }
  try {
    const odd = new Tree();
    odd.put(new Name("a"), 1);
    odd.root.key = k > 5 ? undefined : new Name("b");
    odd.put(new Name("c"), 2);
  } catch (e) {
    thrown += e instanceof TypeError ? 1 : 100;
  }
  out.push(replaced, thrown, byName.kinds(), byPlace.kinds());
  return out.join(" ");
}
console.log(run(3), run(500), run(5000));
