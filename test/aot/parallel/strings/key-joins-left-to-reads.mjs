// this["visit" + node.type]: the read looks for the pair of the key's parts, so the key itself is not joined where the pair is known.
// The keys are of names, strings allocated at run time, pieces, numbers, booleans, null and undefined; the objects have methods, accessors, missing names, prototypes set later, proxies; a key may be too long for a string.
// STATISTIC: KeyJoinsLeftToReads >= 10
const atRunTime = (value) => [value][Math.min(0, process.pid)];
const out = [];
const text = (f) => { try { return String(f()); } catch (error) { return error.constructor.name + ": " + error.message; } };
const types = ["Identifier", "CallExpression", "Literal", "Block", "If", "Return"];

class Visitor {
  constructor() { this.log = ""; }
  visitIdentifier(node) { this.log += "i"; return node.value; }
  visitCallExpression(node) { this.log += "c"; return node.value + this.visit(node.callee); }
  visitLiteral(node) { this.log += "l"; return node.value * 2; }
  visitBlock(node) { this.log += "b"; let sum = 0; for (const child of node.body) sum += this.visit(child); return sum; }
  get visitIf() { this.log += "g"; return (node) => node.value + 100; }
  visit(node) { return this["visit" + node.type](node); }
  visitTemplate(node) { return this[`visit${node.type}`](node); }
  visitMaybe(node) { const visitor = this["visit" + node.type]; return visitor ? visitor.call(this, node) : "none " + node.type; }
  visitChosen(node) { return typeof this["visit" + node.type] === "function" ? this["visit" + node.type](node) : -1; }
  read(suffix) { return typeof this["visit" + suffix]; }
  readReversed(prefix) { return typeof this[prefix + "Literal"]; }
}
class Heir extends Visitor { visitLiteral(node) { return super.visitLiteral(node) + 1; } visitReturn(node) { return "returned " + node.value; } }

const nodes = [];
for (let i = 0; i < 24; i++) nodes.push({ type: i % 5 ? types[i % 6] : atRunTime(types[i % 6]), value: i, callee: { type: "Identifier", value: 1 }, body: [{ type: "Literal", value: 3 }] });
const line = atRunTime("xxIdentifier|Literal|Block|toString|constructor|__proto__");
const pieces = line.slice(2).split("|");
const visitors = [new Visitor(), new Heir(), Object.assign(new Visitor(), { visitReturn: (node) => "own " + node.value }), new Proxy(new Heir(), {})];
const others = [undefined, null, 1, -0, 1.5, true, "x", 10n, ["Literal"], { toString() { return "Literal"; } }, Symbol("s"), { valueOf() { return "Block"; }, toString: null }];
for (let round = 0; round < 3; round++) {
  for (const visitor of visitors) {
    for (const node of nodes) out.push(text(() => visitor.visit(node)), text(() => visitor.visitTemplate(node)), text(() => visitor.visitMaybe(node)), text(() => visitor.visitChosen(node)));
    for (const piece of pieces) out.push(text(() => visitor.read(piece)), text(() => visitor.visitMaybe({ type: piece, value: 1, callee: nodes[0], body: [] })));
    for (const other of others) out.push(text(() => visitor.read(other)), text(() => visitor.visit({ type: other, value: 2 })), text(() => visitor.visitTemplate({ type: other, value: 2 })));
    out.push(text(() => visitor.readReversed("visit")), text(() => visitor.readReversed(atRunTime("vi") + "sit")), visitor.log.length);
  }
  if (round === 0) Visitor.prototype.visitReturn = function (node) { return "late " + node.value; };
  if (round === 1) { delete Visitor.prototype.visitBlock; Heir.prototype.visitIdentifier = () => "replaced"; }
}

// Records, lists, strings and functions under keys of two parts.
const table = { a1: 1, a2: 2, b1: 3, "10": "ten", undefinedx: "u" };
const lookUp = (prefix, suffix) => table[prefix + suffix];
const onString = (string, prefix, suffix) => string[prefix + suffix];
const onAny = (value, suffix) => value["len" + suffix];
for (const prefix of ["a", "b", "1", "", undefined]) for (const suffix of ["1", "2", "0", "x", 1, 0]) out.push(text(() => lookUp(prefix, suffix)), text(() => onString("string", prefix, suffix)), text(() => onString([7, 8, 9], prefix, suffix)));
for (const value of ["four", [1, 2], function (a, b) {}, 5, { length: "own" }, null, undefined]) out.push(text(() => onAny(value, "gth")), text(() => onAny(value, atRunTime("gt") + "h")));

// A key that no string can hold: the join throws, whether or not anything takes what is read.
let long = atRunTime("xxxxxxxx"), longer = "";
for (let i = 0; i < 27; i++) {
  longer += long;
  long += long;
}
longer += long;
const readLong = (object, suffix) => { object["visitAnything" + suffix]; return "read"; };
for (let i = 0; i < 3; i++) out.push(longer.length, text(() => readLong(visitors[0], "Literal")), text(() => readLong(visitors[0], longer)), text(() => readLong({}, longer)));
console.log(out.length, Bun.hash(out.join("~")).toString(36));
console.log(out.slice(0, 40).join(" ").slice(0, 700));
