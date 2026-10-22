// A definition turns a field that the constructor filled into an accessor, or takes its attributes away. In sloppy code, where a refused store is silent.
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
  let reads = 0;
  Object.defineProperty(made[1], "pos", { get() { return ++reads; }, configurable: true, enumerable: true });
  Object.defineProperty(made[2], "flags", { value: 9, writable: false });
  Object.defineProperty(made[3], "parent", { value: "hidden", enumerable: false });
  Object.defineProperties(made[4], { kind: { get() { return 100; } }, end: { value: 2.5 } });
  Reflect.defineProperty(made[5], "name", { get() { return "by Reflect"; } });
  made[6].__defineGetter__("end", function () { return this.pos + 1000; });
  made[7].__defineSetter__("flags", function (value) { this.kind = value; });
  attempt("a store into a read-only field", () => { made[2].flags = 10; });
  made[7].flags = 77;
  for (let i = 0; i < 9; i++) show(i, made[i]);
  console.log(reads, Object.getOwnPropertyDescriptor(made[2], "flags").writable, Object.getOwnPropertyDescriptor(made[3], "parent").enumerable);
  console.log(Maker.name, readAll(made));
}
