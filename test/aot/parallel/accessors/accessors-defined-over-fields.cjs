// Accessors are defined on a prototype, under names that the constructor stores: objects allocated before keep their fields, later ones run the setter and are complete without the field.
const define = (target, key, descriptor) => Object.defineProperty(target, key, descriptor);
const said = [];
class Node {
  constructor(kind, pos) {
    this.pos = pos;
    this.kind = kind;
    this.flags = 0;
    this.parent = undefined;
  }
  getStart() {
    return this.pos;
  }
}
class Leaf extends Node {
  constructor(kind, pos) {
    super(kind, pos);
    this.text = "leaf" + kind;
  }
}
function create(kind, parent) {
  const node = new Node(kind, kind + 1);
  node.parent = parent;
  return node;
}
function depth(node) {
  let sum = 0;
  while (node) {
    sum += node.kind + node.flags + node.getStart();
    node = node.parent;
  }
  return sum;
}
function work(label) {
  let sum = 0;
  for (let i = 0; i < 60; i++) {
    let last;
    for (let k = 0; k < 5; k++) last = create(k & 3, last);
    sum += depth(last);
    const leaf = new Leaf(i & 3, 2);
    sum += leaf.kind + leaf.flags + leaf.getStart() + (leaf.text || "none").length;
  }
  said.push(label, sum, Object.keys(create(1)).join(), Object.keys(new Leaf(1, 2)).join(), JSON.stringify(create(2)));
}
const early = create(3);
work("fields");
define(Node.prototype, "flags", { get() { return this.hidden + 1; }, set(value) { this.hidden = value; }, configurable: true, enumerable: true });
work("accessor");
early.flags = 7;
said.push(early.flags, Object.keys(early).join(), depth(early));
define(Node.prototype, "kind", { get() { return 5; }, set(value) {}, configurable: true });
work("two accessors");
delete Node.prototype.kind;
work("one again");
define(Node.prototype, "pos", { value: 9, writable: false, configurable: true });
try {
  work("read-only");
} catch (error) {
  said.push(error.constructor.name);
}
delete Node.prototype.pos;
define(Node.prototype, "parent", { get() { return null; }, configurable: true });
try {
  work("getter alone");
} catch (error) {
  said.push(error.constructor.name);
}
delete Node.prototype.parent;
delete Node.prototype.flags;
work("fields again");
let runs = 0;
define(Leaf.prototype, "text", { get() { return "got"; }, set(value) { if (++runs === 30) delete Leaf.prototype.text; }, configurable: true });
work("removed while it runs");
said.push(runs);
function Old(a, b) {
  this.a = a;
  this.b = b;
  this.c = 1;
}
const olds = () => {
  let sum = 0;
  for (let i = 0; i < 50; i++) {
    const old = new Old(i, 2);
    sum += old.a + old.b + old.c;
  }
  return sum + Object.keys(new Old(1, 2)).join();
};
said.push(olds());
define(Old.prototype, "b", { get() { return 3; }, set(value) { this.late = value; }, configurable: true });
said.push(olds(), new Old(1, 4).late);
Object.freeze(Old.prototype);
said.push(olds());
console.log(said.join("\n"));
