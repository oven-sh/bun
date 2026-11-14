// Compared in a loop, the first four or last four common bytes decide in line; everything else is compared by the runtime.
class Key {
  constructor(text) {
    this.text = text;
  }
  compareTo(other) {
    return this.text.localeCompare(other.text);
  }
}
class Node {
  constructor(key) {
    this.key = key;
    this.left = null;
    this.right = null;
    this.count = 1;
  }
}
class Tree {
  constructor() {
    this.root = null;
  }
  add(key) {
    let above = null, order = 0;
    for (let node = this.root; node; ) {
      above = node;
      order = key.compareTo(node.key);
      if (order < 0) node = node.left;
      else if (order > 0) node = node.right;
      else return ++node.count;
    }
    const added = new Node(key);
    if (!above) this.root = added;
    else if (order < 0) above.left = added;
    else above.right = added;
    return 0;
  }
  list(out) {
    const stack = [];
    for (let node = this.root; node || stack.length; ) {
      if (node) {
        stack.push(node);
        node = node.left;
        continue;
      }
      node = stack.pop();
      out.push(node.key.text + ":" + node.count);
      node = node.right;
    }
    return out;
  }
}
let seed = 11;
const random = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
const parts = ["foo", "Foo", "fo", "", "f", "bar", "é", "日", "-", "_", " ", "a", "A", "0", "9", "10", "~", "\t"];
const words = [];
for (let i = 0; i < 600; i++) {
  let word = "";
  for (let k = random(5); k >= 0; k--) word += parts[random(i % 3 ? 3 : parts.length)] + (random(3) ? random(1000) : "");
  words.push(word, i % 2 ? word : word.slice(0, -1));
}
const tree = new Tree();
for (const word of words) tree.add(new Key(word));
const inOrder = tree.list([]);
const collator = new Intl.Collator();
let wrong = 0, sum = 0;
for (let i = 0; i < words.length; i++) {
  const left = words[i];
  for (let j = 0; j < words.length; j += 7) {
    const order = left.localeCompare(words[j]);
    sum = (sum * 31 + order) | 0;
    if ((i + j) % 11 === 0 && order !== collator.compare(left, words[j])) wrong++;
  }
}
console.log(inOrder.length, wrong, sum, inOrder.slice(0, 30).join("|"), inOrder.slice(-5).join("|"));
