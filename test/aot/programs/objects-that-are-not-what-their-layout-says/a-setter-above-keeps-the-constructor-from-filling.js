// A setter on the prototype chain takes the store of the constructor: the object never gets the property.
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
const taken = [];
for (const Maker of [Node, Token]) {
  console.log(Maker.name, readAll(make(Maker, 40)));
  Object.defineProperty(Maker.prototype, "pos", { set(value) { taken.push(value); }, get() { return "pos from above"; }, configurable: true });
  const middle = Object.defineProperty({}, "flags", { set(value) { taken.push("flags " + value); }, get() { return 32; }, configurable: true });
  Object.setPrototypeOf(Maker.prototype, middle);
  const made = make(Maker, 40);
  for (let i = 0; i < 3; i++) show(i, made[i]);
  console.log(readAll(made), taken.length, taken.slice(0, 4).join());
  delete Maker.prototype.pos;
  delete middle.flags;
  for (let i = 0; i < 3; i++) show(i, made[i]);
  made[1].pos = 4;
  made[1].flags = 8;
  show("stored", made[1]);
  show("new", new Maker(1, 2, 3));
  taken.length = 0;
}
