// A field holds a record in one arm and a list in the other, so that names are read and called off lists: those of the program, and those that the engine names.
function tag(strings) { return strings; }
class Heir extends Array { get kind() { return "heir" + this.length; } at2() { return this[1]; } }
const makers = [
  n => ({ kind: "record", value: n, raw: [n] }), n => [n, n + 1], n => [], n => (n & 1 ? [n] : { kind: "odd", index: n }), n => n, n => "text" + n,
  n => tag`a${n}b`, n => /(?<first>\w)(\d)/.exec("a" + (n % 10)), n => [..."a1b2".matchAll(/\d/g)][n & 1], n => Object.assign([n], { raw: [n], kind: "named" }), n => Heir.of(n, 2), n => [n].map(x => x), n => JSON.parse("[1,2]"), n => Array.from({ length: n & 3 }),
];
function kindOf(v) { return v.kind; }
function rawOf(v) { return v.raw; }
function read(v) { const kind = kindOf(v), raw = rawOf(v); return String(kind) + (raw === undefined ? "-" : Array.isArray(raw) ? raw.map(x => x + "!").join() : typeof raw) + String(v.index) + typeof v.other; }
function call(v) { try { return String(v.at2()); } catch (error) { return error.constructor.name; } }
function evaluate(node) {
  switch (node.kind) {
    case "number": return node.value;
    case "list": { let sum = 0; for (const each of node.value) sum += evaluate(each); return sum; }
    case "not": return evaluate(node.value) ? 0 : 1;
    default: return node.length ?? 100;
  }
}
function tree(n) { return n % 4 === 0 ? { kind: "number", value: n } : n % 4 === 1 ? { kind: "list", value: [tree(n - 1), tree(n >> 1)] } : n % 4 === 2 ? { kind: "not", value: tree(n - 1) } : { kind: "not", value: [tree(n >> 2)] }; }
for (let n = 0; n < 6; n++) console.log(makers.map(make => read(make(n))).join(" "), makers.map(make => call(make(n))).join(" "));
let total = 0;
for (let n = 0; n < 80; n++) total += evaluate(tree(n));
console.log(total);
