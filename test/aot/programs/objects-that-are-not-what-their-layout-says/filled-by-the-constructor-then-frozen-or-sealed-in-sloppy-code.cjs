// Stores into frozen, sealed and closed objects are refused or taken by the rules, and what was deleted from a closed object stays away. In sloppy code, where a refused store is silent.
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
function store(node) {
  attempt("pos", () => { node.pos = 90; });
  attempt("flags", () => { node.flags |= 2; });
  attempt("parent", () => { node.parent = "stored"; });
  return node;
}
for (const Maker of [Node, Token]) {
  const made = make(Maker, 40);
  console.log(Maker.name, readAll(made));
  show("frozen", store(Object.freeze(made[1])));
  show("sealed", store(Object.seal(made[2])));
  show("closed", store(Object.preventExtensions(made[3])));
  delete made[3].pos;
  delete made[3].flags;
  show("closed, deleted", store(made[3]));
  console.log(attempt("delete", () => delete made[2].pos), Object.isFrozen(made[1]), Object.isSealed(made[2]), Object.isExtensible(made[3]));
  show("free", store(made[4]));
  console.log(Maker.name, readAll(made));
}
