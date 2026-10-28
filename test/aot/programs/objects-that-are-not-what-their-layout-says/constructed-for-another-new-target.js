// Reflect.construct makes the object for another function: under its prototype, with whatever lies there.
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
function Other() {}
Object.defineProperty(Other.prototype, "pos", { set(value) { this.hidden = value; }, get() { return "pos of Other"; }, configurable: true });
function Bare() {}
Bare.prototype = null;
class Heir extends Token {}
const bound = Node.bind(null, 9);
for (const Maker of [Node, Token]) {
  console.log(Maker.name, readAll(make(Maker, 40)));
  for (const target of [Other, Bare, Heir, Maker, Array, function () {}]) {
    const made = [];
    for (let i = 0; i < 20; i++) made.push(Reflect.construct(Maker, [i, i * 2, i * 3], target));
    console.log(readAll(made), Object.getPrototypeOf(made[3]) === target.prototype, made[3] instanceof Maker);
    show(target.name, made[3]);
  }
}
show("bound", new bound(1, 2));
show("bound, for Other", Reflect.construct(bound, [1, 2], Other));
