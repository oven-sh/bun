// Reflect stores, defines and deletes, also with the object as the receiver of a store that starts elsewhere. In sloppy code, where a refused store is silent.
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
  console.log(Reflect.set(made[1], "pos", 1.5), Reflect.set(made[2], "flags", undefined), Reflect.set({}, "end", "from elsewhere", made[3]));
  console.log(Reflect.set(Object.create(made[4]), "kind", "below"), Reflect.set(Maker.prototype, "name", "through the prototype", made[5]));
  console.log(Reflect.defineProperty(made[6], "parent", { get() { return "got"; } }), Reflect.deleteProperty(made[7], "end"), Reflect.deleteProperty(made[7], "end"));
  console.log(Reflect.preventExtensions(made[8]), Reflect.deleteProperty(made[8], "pos"), Reflect.set(made[8], "pos", 1));
  console.log(Reflect.ownKeys(made[7]).join(), Reflect.has(made[8], "pos"), Reflect.get(made[6], "parent"));
  for (let i = 0; i < 10; i++) show(i, made[i]);
  console.log(Maker.name, readAll(made));
}
