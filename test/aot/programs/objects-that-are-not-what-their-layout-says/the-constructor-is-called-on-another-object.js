// A constructor function is called as a function: on a plain object, on an object under its prototype, on one that is filled, frozen or of another class.
function Node(kind, pos, end) {
  this.kind = kind;
  this.pos = pos;
  this.end = end;
  this.flags = 0;
  this.parent = null;
  this.name = "n" + kind;
}
class Token {
  constructor(kind, pos, end) {
    this.kind = kind;
    this.pos = pos;
    this.end = end;
    this.flags = 0;
    this.parent = null;
    this.name = "t" + kind;
  }
}
function describe(node) {
  return node.kind + " " + node.pos + " " + node.end + " " + node.flags + " " + node.parent + " " + node.name;
}
function bits(node) {
  return (node.kind | node.flags) + (node.pos & 255) + (node.end >> 1);
}
function own(node) {
  return Object.keys(node).join() + " " + ("pos" in node) + " " + Object.hasOwn(node, "flags") + " " + Object.hasOwn(node, "parent");
}
function make(Maker, count) {
  const made = [];
  for (let i = 0; i < count; i++) made.push(new Maker(i, i * 2, i * 3));
  return made;
}
function readAll(made) {
  let sum = 0;
  for (const node of made) sum += describe(node).length + bits(node);
  return sum;
}
function show(label, node) {
  console.log(label, "|", describe(node), "|", bits(node), "|", own(node));
}
function attempt(label, action) {
  try {
    return action();
  } catch (error) {
    console.log(label, error.constructor.name);
  }
}
function fill(target, kind) {
  attempt("filling " + kind, () => Node.call(target, kind, kind * 2, kind * 3));
  return target;
}
console.log(readAll(make(Node, 40)));
show("plain", fill({}, 1));
show("below the prototype", fill(Object.create(Node.prototype), 2));
show("half filled", fill({ end: "was here", kind: "was here" }, 3));
show("a token", fill(new Token(9, 9, 9), 4));
show("a node again", fill(new Node(9, 9, 9), 5));
show("without a prototype", fill(Object.create(null), 6));
show("an array", fill([1, 2], 7));
show("a function", fill(function named() {}, 8));
const deleted = new Node(9, 9, 9);
delete deleted.pos;
delete deleted.flags;
show("deleted, filled again", fill(deleted, 10));
const frozen = Object.freeze(new Node(9, 9, 9));
show("frozen", fill(frozen, 11));
const never = Object.create(Node.prototype);
show("never filled", never);
console.log(readAll([never, fill(Object.create(Node.prototype), 12), new Node(1, 2, 3)]));
