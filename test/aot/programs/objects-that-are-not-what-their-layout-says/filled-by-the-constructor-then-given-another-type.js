// A store of a value that the slot cannot hold moves the field out of it.
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
  made[1].pos = 1.5;
  made[2].flags = "many";
  made[3].kind = { valueOf() { return 3; }, toString() { return "three"; } };
  made[4].end = 2 ** 31;
  made[5].pos = -0;
  made[6].flags = NaN;
  made[7].parent = 12;
  made[8].name = 13;
  made[9].kind = 10n ** 3n > 5n;
  made[10].end = Symbol.iterator.description;
  made[11].pos = -(2 ** 31);
  made[12].pos = -(2 ** 31) + 1;
  made[13].pos = -(2 ** 31) + 4;
  for (let i = 0; i < 15; i++) show(i, made[i]);
  console.log(Object.is(made[5].pos, -0), 1 / made[5].pos);
  console.log(Maker.name, readAll(made));
}
