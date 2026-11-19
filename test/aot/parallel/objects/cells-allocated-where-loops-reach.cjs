// Functions that nested loops and recursion reach allocate cells in place: objects of every size, instances, environments of iterations, closures, cells whose empty fields are not zero, between collections and refills of the free lists.
// STATISTIC: CellsAllocatedInline >= 30
"use strict";
const out = [];
class Leaf { constructor(kind, value) { this.kind = kind; this.value = value; this.next = null; } }
class Heir extends Leaf { constructor(kind, value) { super(kind, value); this.count = 7; } }
class Late { constructor(first) { this.first = first; this.flag = false; } settle(second) { this.second = second; if (second & 1) this.third = second * 0.5; return this; } }
class Wide { constructor(n) { this.a = n; this.b = n + 1; this.c = n + 0.5; this.d = "d" + n; this.e = undefined; this.f = null; this.g = n; this.h = [n]; this.i = -n; this.j = n; this.k = n; this.l = n; } }
function tree(depth, seed) {
  if (depth === 0) return seed % 3 === 0 ? new Leaf("leaf", seed) : seed % 3 === 1 ? { kind: "plain", value: seed, next: null } : new Heir("heir", seed + 0.5);
  const left = tree(depth - 1, seed * 2 + 1);
  const right = tree(depth - 1, seed * 2 + 2);
  return { kind: "branch", left, right, next: null, value: seed, span: { start: depth, end: seed } };
}
function weigh(node) {
  if (!node) return 0;
  let sum = node.kind.length + (node.value | 0) + (node.count | 0) + weigh(node.left) + weigh(node.right) + weigh(node.next);
  if (node.span) sum += node.span.start * 3 + (node.span.end & 15);
  return sum;
}
function late(n) { const made = new Late(n); if (n % 2) made.settle(n); else if (n % 3) made.extra = n; return made; }
function makers(rows) {
  const made = [];
  for (const row of rows) for (const cell of row) {
    let held = cell;
    made.push({ read: () => held, write: (next) => { held = next; return { held, cell }; }, both: (add) => () => held + cell + add });
  }
  return made;
}
function sizes(n) {
  const all = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) all.push({}, { a: i }, { a: i, b: j }, { a: i, b: j, c: i }, { a: i, b: j, c: i, d: null }, { a: i, b: j, c: i, d: undefined, e: "e" }, { a: i, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: j }, new Wide(i + j));
  return all;
}
function list(n, tail) { return n === 0 ? tail : list(n - 1, { n, tail, half: n / 2 }); }
class Parser {
  constructor(text) { this.text = text; this.at = 0; this.depth = 0; this.seen = []; }
  peek() { return this.at < this.text.length ? this.text[this.at] : ""; }
  position() { return { line: this.depth, column: this.at }; }
  node(kind, start, value) { const made = { kind, start, end: this.position(), value, next: undefined, flags: false }; this.seen.push(made); return made; }
  sum() { let left = this.product(); while (this.peek() === "+" || this.peek() === "-") { const start = this.position(); const operator = this.text[this.at++]; left = this.node(operator, start, { left, right: this.product(), operator }); } return left; }
  product() { const left = this.factor(); if (this.peek() !== "*") return left; const start = this.position(); this.at++; return this.node("*", start, [left, this.product()]); }
  factor() {
    const start = this.position();
    if (this.peek() === "(") { this.at++; this.depth++; const inner = this.sum(); this.depth--; this.at++; return this.node("group", start, () => inner); }
    if (this.peek() === "-") { this.at++; return this.node("minus", start, new Leaf("minus", this.factor())); }
    let value = 0;
    while (this.peek() >= "0" && this.peek() <= "9") value = value * 10 + (this.text.charCodeAt(this.at++) - 48);
    return this.node("number", start, value);
  }
  worth(node) {
    const value = node.value;
    if (typeof value === "number") return value;
    if (typeof value === "function") return this.worth(value());
    if (Array.isArray(value)) return this.worth(value[0]) * this.worth(value[1]);
    if (node.kind === "minus") return -this.worth(value.value);
    return value.operator === "+" ? this.worth(value.left) + this.worth(value.right) : this.worth(value.left) - this.worth(value.right);
  }
}
function parseOne(text) { const parser = new Parser(text); const root = parser.sum(); return parser.worth(root) + " " + parser.seen.length + " " + JSON.stringify(parser.seen.at(-1).end) + JSON.stringify(parser.seen[0]); }
function parseAll(texts) { const all = []; for (const text of texts) all.push(parseOne(text)); return all; }
for (const each of [Parser, parseOne, parseAll, Leaf, Heir, Late, Wide, tree, weigh, late, makers, sizes, list]) globalThis["kept" + each.name] = each;
const keep = [];
for (let round = 0; round < 12; round++) {
  const root = tree(10, round);
  if (round % 3 === 0) keep.push(root);
  out.push("tree " + weigh(root));
  const lates = [];
  for (let i = 0; i < 400; i++) lates.push(late(i));
  out.push("late " + lates.reduce((sum, l) => sum + l.first + (l.second ?? 1) + (l.third ?? 2) + (l.extra ?? 3) + (l.flag ? 1 : 0), 0) + " " + Object.keys(lates[1]) + " " + Object.keys(lates[4]) + " " + JSON.stringify(lates[3]));
  const made = makers([[1, 2, 3], [round, round + 0.5], [4]]);
  out.push("makers " + made.map(m => m.read() + m.write(m.read() + 10).held + m.read() + m.both(1)()).join(","));
  const all = sizes(60);
  out.push("sizes " + all.length + " " + JSON.stringify(all.slice(8, 16)) + " " + all.reduce((sum, each) => sum + Object.keys(each).length + (each.h?.length ?? each.h ?? 0), 0));
  let words = "1";
  for (let i = 0; i < 120; i++) words += ["+2", "*3", "-(4+" + i + ")", "+-7"][i % 4];
  out.push("parsed " + parseAll([words, "(1+2)*(3-(4*5))", "-(-(-9))", "12*12*12", "((((7))))-" + round]).join("; "));
  let sum = 0;
  for (let l = list(300, null); l; l = l.tail) sum += l.n + l.half;
  out.push("list " + sum);
  if (round === 2) Object.setPrototypeOf(Heir.prototype, Object.assign(Object.create(Leaf.prototype), { extra: 1 }));
  if (round % 4 === 3) { if (typeof Bun !== "undefined") Bun.gc(true); out.push("kept " + keep.map(weigh).join(" ")); }
}
for (const line of out) console.log(line);
