// A proxy on the prototype chain answers the stores of the constructor and the reads of what it kept.
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
  console.log(Maker.name, readAll(make(Maker, 40)));
  const log = [];
  const above = Object.getPrototypeOf(Maker.prototype);
  Object.setPrototypeOf(Maker.prototype, new Proxy({}, {
    set(target, key, value, receiver) {
      log.push(String(key));
      if (key === "pos" || key === "parent") return true;
      return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true });
    },
    get(target, key) { return typeof key === "string" ? "proxy " + key : undefined; },
    has(target, key) { return key === "pos"; },
  }));
  const made = make(Maker, 40);
  for (let i = 0; i < 3; i++) show(i, made[i]);
  console.log(readAll(made), log.length, log.slice(0, 6).join());
  Object.setPrototypeOf(Maker.prototype, above);
  for (let i = 0; i < 3; i++) show(i, made[i]);
  show("after", new Maker(1, 2, 3));
}
