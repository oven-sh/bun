// compare(key, node.key) calls a method of what stays: each class has its own loop, anything else the general one.
class Word {
  constructor(text) {
    this.text = text;
  }
  compareTo(other) {
    return this.text < other.text ? -1 : this.text > other.text ? 1 : 0;
  }
}
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  compareTo(other) {
    return this.x - other.x || this.y - other.y;
  }
}
function compare(a, b) {
  return a.compareTo(b);
}
class Tree {
  constructor() {
    this.root = null;
  }
  find(key) {
    let steps = 0;
    for (let node = this.root; node; steps++) {
      const order = compare(key, node.key);
      if (!order) return steps;
      node = order < 0 ? node.left : node.right;
    }
    return -1 - steps;
  }
  add(key) {
    let parent = null;
    for (let node = this.root; node; ) {
      parent = node;
      const order = compare(key, node.key);
      if (!order) return false;
      node = order < 0 ? node.left : node.right;
    }
    const added = { key, left: null, right: null };
    if (!parent) this.root = added;
    else if (compare(key, parent.key) < 0) parent.left = added;
    else parent.right = added;
    return true;
  }
}
const words = new Tree(), points = new Tree();
let added = 0, found = 0, said = "";
for (let i = 0; i < 200; i++) added += +words.add(new Word("w" + ((i * 37) % 151))) + +points.add(new Point((i * 13) % 29, (i * 7) % 11));
for (let i = 0; i < 260; i++) found = (found * 31 + words.find(new Word("w" + i)) + points.find(new Point(i % 31, i % 13))) | 0;
for (const odd of [undefined, null, 7, { compareTo: () => 0 }, { compareTo: other => other.text.length - 2 }, new Point(1, 2)])
  try {
    said += words.find(odd) + " ";
  } catch (error) {
    said += error.constructor.name + " ";
  }
Word.prototype.compareTo = function (other) {
  return this.text.length - other.text.length;
};
said += words.find(new Word("w1")) + " " + words.find(new Word("w")) + " ";
const own = new Word("w5");
own.compareTo = () => 1;
said += words.find(own) + " ";
let calls = 0;
class Proxied extends Point {
  compareTo(other) {
    calls++;
    return super.compareTo(other);
  }
}
said += points.find(new Proxied(3, 4)) + " " + points.find(new Proxy(new Point(3, 4), {})) + " " + calls;
console.log(added, found, said);
