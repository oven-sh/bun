// A field that was deleted and stored again is the last of the keys, and the object was disturbed for good.
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
for (const Maker of [Node, Token]) {
  const made = make(Maker, 40);
  console.log(Maker.name, readAll(made));
  delete made[1].pos;
  made[1].pos = 7;
  delete made[2].flags;
  made[2].flags = 1.5;
  delete made[3].parent;
  made[3].parent = made[4];
  made[3].parent.name = "above";
  delete made[5].kind;
  delete made[5].end;
  made[5].end = 1;
  made[5].kind = 2;
  for (let i = 0; i < 7; i++) show(i, made[i]);
  console.log(JSON.stringify(made[5]), Object.entries(made[1]).join(";"));
  console.log(Maker.name, readAll(made));
}
