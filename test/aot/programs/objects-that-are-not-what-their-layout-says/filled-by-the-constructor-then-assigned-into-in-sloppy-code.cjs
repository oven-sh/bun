// Object.assign stores into an object that a constructor filled, and a getter of the source disturbs the target half way. In sloppy code, where a refused store is silent.
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
  Object.assign(made[1], { pos: 1.5, flags: undefined });
  Object.assign(made[2], { kind: "k", extra: 1 }, { end: null });
  Object.assign(made[3], made[4], { name: "copy of 4" });
  Object.assign(made[5], { get pos() { delete made[5].end; delete made[5].flags; return 50; }, end: 51 });
  Object.assign(made[6], { get kind() { Object.defineProperty(made[6], "pos", { get() { return "accessor"; }, configurable: true }); return 60; }, name: "six" });
  Object.assign(made[7], [70, 71], "ab");
  const spread = { ...made[8], pos: "spread" };
  for (let i = 0; i < 10; i++) show(i, made[i]);
  show("spread", spread);
  console.log(Maker.name, readAll(made));
}
