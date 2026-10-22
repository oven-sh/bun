// The same sites of the constructor store first into slots, then into a setter that has arrived above, then into slots again.
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
let taken = 0;
function round(Maker, label) {
  const made = make(Maker, 300);
  console.log(label, readAll(made), own(made[299]), describe(made[299]));
  return made;
}
for (const Maker of [Node, Token]) {
  const first = round(Maker, "before");
  Object.defineProperty(Maker.prototype, "end", { set(value) { taken += value; }, get() { return -1; }, configurable: true });
  const second = round(Maker, "under the setter");
  Object.defineProperty(Maker.prototype, "end", { value: "read only above", writable: false, configurable: true });
  const third = attempt("under a read-only property", () => round(Maker, "under a read-only property")) ?? [];
  delete Maker.prototype.end;
  const fourth = round(Maker, "after");
  console.log(taken, describe(first[7]), "|", describe(second[7]), "|", third.length && describe(third[7]), "|", describe(fourth[7]));
  console.log(readAll(first), readAll(second), readAll(third), readAll(fourth));
}
