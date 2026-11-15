// Methods whose name one function bears are handed instances of a class by name, and other values too.
"use strict"; const out = []; let i = 0, calls = 0; const show = (v) => { try { return v && typeof v === "object" ? v.constructor && v.constructor.name + "{" + Object.keys(v).join() + "}" : typeof v === "function" ? "fn" : String(v); } catch (e) { return "E" + e.constructor.name; } };
class Pos { constructor(line, column) { this.line = line; this.column = column; } at() { return this.line; } }
class Kind { constructor(label, conf = {}) { this.label = label; this.prefix = !!conf.prefix; this.update = null; } }
class Word extends Kind { constructor(label) { super(label, { prefix: true }); this.word = label; } }
const kinds = { a: new Kind("a"), b: new Word("b"), c: new Kind("c") };
for (const n of ["x", "y"]) kinds["_" + n] = new Word(n);
class Node { constructor(start) { this.start = start; this.end = 0; this.kind = kinds.a; this.pos = new Pos(start, 1); }  }
class State {  init(n) { this.kind = kinds.a; this.pos = new Pos(n, 0); this.node = null; this.list = [new Pos(1, 2)]; this.count = n; this.last = this.pos; return this; } copy() { return Object.assign(new State(), this); } }
function plain(node, depth) { let t = ""; if (node.kind) t += "y"; return t + this.m0(node, depth + 1); }
class Parser { constructor() { this.state = new State(); this.state.init(1); } }
{ const pp = Parser.prototype; pp.m0 = function (node, depth) { let s = ""; calls++; delete node.start; s += Object.keys(node).length; s += Object.keys(node).length; const k = this.state.copy(); s += k.kind === this.state.kind; return s; }; pp.m1 = function (node, depth) { let s = ""; calls++; node.extra += 1; s += String(node.end); { const q1 = node; s += q1.name > 1; } { const q1 = node; s += q1.late > 1; } s += this.state.kind.label; return s; }; pp.m2 = function (node, depth) { let s = ""; calls++; s += Object.keys(node).length; s += String(node.start); if (depth < 2) s += plain.call(this, node, depth + 1); return s; }; pp.m3 = function (node, depth) { let s = ""; calls++; delete node.kind; if (node.start) s += "y"; s += String(node.extra); if (depth < 2) s += this.m3(this.make(depth), depth + 1); return s; }; pp.make = function (d) { const n = new Node(d);  return n; }; pp.take = function (node) { node.taken = 1; return node; }; pp.pick = function (d) { return new Node(d); }; }
class Twin { m0(node) { return "twin"; } make() { return 5; } take(n) { return n; } }
globalThis.kept = [Parser, Node, State, Pos, Kind, Word]; if (process.argv[9]) { new Node(1)[process.argv[9]] = 2; new State()[process.argv[9]] = 3; kinds[process.argv[9]] = 4; new Pos(1, 2)[process.argv[9]] = 5; }
const nodes = [(p) => p.make(1), (p) => new Node(2), (p) => ({ start: 1, end: 2, kind: kinds.b }), (p) => new Pos(1, 2), (p) => Object.freeze(new Node(3)), (p) => p.take(new Node(4)), (p) => null, (p) => undefined, (p) => 7, (p) => "text", (p) => Object.create(new Node(5)), (p) => new Proxy(new Node(6), {}), (p) => { const n = new Node(8); Object.defineProperty(n, "start", { get() { return "acc"; }, configurable: true }); return n; }, (p) => new (class Heir extends Node { })(9), (p) => [1], (p) => kinds.b, (p) => p.state];
for (let turn = 0; turn < 3; turn++) {
  if (turn === 2) { Pos.prototype.at = function () { return "other"; }; }
  for (let k = 0; k < nodes.length; k++) { const p = new Parser(); i = k;
    try { out.push("m0 " + turn + " " + k + " " + p.m0(nodes[k](p), turn)); } catch (e) { out.push("m0 " + turn + " " + k + " T" + e.constructor.name); }
    try { out.push("m1 " + turn + " " + k + " " + p.m1(nodes[k](p), turn)); } catch (e) { out.push("m1 " + turn + " " + k + " T" + e.constructor.name); }
    try { out.push("m2 " + turn + " " + k + " " + p.m2(nodes[k](p), turn)); } catch (e) { out.push("m2 " + turn + " " + k + " T" + e.constructor.name); }
    try { out.push("m3 " + turn + " " + k + " " + p.m3(nodes[k](p), turn)); } catch (e) { out.push("m3 " + turn + " " + k + " T" + e.constructor.name); }
    try { out.push(show(p.state) + show(p.state.kind) + show(p.state.pos) + show(p.state.last) + show(p.take(nodes[k](p))) + show(p.pick(k))); } catch (e) { out.push("T" + e.constructor.name); }
  }
}
out.push(calls);
for (const line of out) console.log(String(line).slice(0, 260));
