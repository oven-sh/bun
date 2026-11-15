// Small methods that run in nested iterations and are copied into their callers: they are replaced, wrapped, deleted, inherited through other objects, throw and come back.
"use strict"; const out = []; let calls = 0, stop = -1;
class Position { constructor(line, col) { this.line = line; this.column = col; } }
class Location { constructor(start, end) { this.start = start; this.end = end; } }
class Token { constructor(state) { this.type = state.type; this.value = state.value; this.start = state.start; this.end = state.end; this.loc = new Location(state.startLoc, state.endLoc); } }
class Node { constructor(p, pos, loc) { this.type = ""; this.start = pos; this.end = 0; this.loc = new Location(loc); if (p && p.ranges) this.range = [pos, 0]; } }
class State { constructor(input) { this.input = input; this.pos = 0; this.line = 1; this.lineStart = 0; this.start = 0; this.end = 0; this.type = "none"; this.value = null; this.startLoc = this.endLoc = this.here(); this.lastEnd = 0; this.lastLoc = null; this.context = ["top"]; this.tokens = []; this.depth = 0; return this; } here() { return new Position(this.line, this.pos - this.lineStart); } ctx() { return this.context[this.context.length - 1]; } copy() { const o = new State(this.input); for (const k in this) o[k] = this[k]; return o; } }
class Scanner { constructor(input) { this.state = new State(input); this.input = input; this.log = 0; }
 at() { const c = this.input.charCodeAt(this.state.pos); return c >= 0xd800 && c < 0xe000 ? (c << 10) + this.input.charCodeAt(this.state.pos + 1) : c; }
 ctx() { return this.state.context[this.state.context.length - 1]; }
 skip() { loop: while (this.state.pos < this.input.length) { const c = this.input.charCodeAt(this.state.pos); switch (c) { case 32: case 9: ++this.state.pos; break; case 10: ++this.state.pos; ++this.state.line; this.state.lineStart = this.state.pos; break; case 35: this.comment(); break; default: break loop; } } }
 comment() { const start = this.state.pos; while (this.state.pos < this.input.length && this.input.charCodeAt(this.state.pos) !== 10) ++this.state.pos; this.note(start, this.state.pos); }
 note(a, b) { calls++; this.log += b - a; if (calls === stop) throw new RangeError("stop" + a); globalThis.hook(this, calls); }
 word() { let w = "", start = this.state.pos; while (this.state.pos < this.input.length) { const c = this.at(); if (isWord(c)) { this.state.pos += c <= 0xffff ? 1 : 2; } else if (c === 92) { w += this.input.slice(start, this.state.pos); this.note(0, 1); ++this.state.pos; start = this.state.pos; } else break; } return w + this.input.slice(start, this.state.pos); }
 finish(type, value) { this.state.end = this.state.pos; this.state.endLoc = this.state.here(); const prev = this.state.type; this.state.type = type; this.state.value = value; this.update(prev); }
 update(prev) { const t = this.state.type; if (t === "(") { this.state.context.push(prev); } else if (t === ")") { if (this.state.context.length > 1) this.state.context.pop(); } else this.state.depth = this.state.context.length; }
 nextToken() { const c = this.ctx(); if (!c || c !== "raw") this.skip(); this.state.start = this.state.pos; this.state.startLoc = this.state.here(); if (this.state.pos >= this.input.length) return this.finish("eof", undefined); return this.read(this.at()); }
 read(c) { if (isWord(c)) return this.finish("name", this.word()); ++this.state.pos; return this.finish(String.fromCharCode(c), c); }
 next() { this.state.tokens.push(new Token(this.state)); this.state.lastEnd = this.state.end; this.state.lastLoc = this.state.endLoc; this.nextToken(); }
 match(t) { return this.state.type === t; } eat(t) { if (this.match(t)) { this.next(); return true; } return false; }
 startNode() { return new Node(this, this.state.start, this.state.startLoc); } finishNode(n, t) { n.type = t; n.end = this.state.lastEnd; n.loc.end = this.state.lastLoc; return n; }
}
class Parser extends Scanner {
 parse() { this.nextToken(); const n = this.startNode(); n.body = []; while (!this.match("eof")) n.body.push(this.statement()); return this.finishNode(n, "Program"); }
 statement() { if (this.match("(")) { const n = this.startNode(); this.next(); n.items = []; while (!this.eat(")")) { if (this.match("eof")) throw new SyntaxError("open" + this.state.pos); n.items.push(this.statement()); } return this.finishNode(n, "List"); } return this.atom(); }
 atom() { const n = this.startNode(); n.name = this.state.value; const t = this.state.type; this.next(); return this.finishNode(n, t === "name" ? "Name" : "Other"); }
}
function isWord(c) { if (c < 48) return c === 36; if (c < 58) return true; if (c < 65) return false; if (c < 91) return true; if (c < 97) return c === 95; if (c < 123) return true; return c >= 0xaa && c < 0x3000; }
globalThis.kept = [State, Token, Node, Position, Scanner, Parser, Location]; globalThis.hook = (s, n) => {}; if (process.argv[9]) { new State()[process.argv[9]] = 1; new Parser("")[process.argv[9]] = 2; }
const text = (v, d = 0) => typeof v === "function" ? "fn" : v === null || typeof v !== "object" ? typeof v + String(v) : Array.isArray(v) ? "[" + v.map((x) => text(x, d + 1)).join() + "]" : d > 4 ? "deep" : "{" + Object.keys(v).map((k) => k + ":" + text(v[k], d + 1)).join() + "}";
const inputs = ["a (b c) d", "((x) y) # z\n w", "one two\nthree (four five six)", "+ - * 9", ")", "(((", "caf\u00e9 \ud83d\ude00 k\\l"];
function one(input) { let p, q; try { p = new Parser(input); q = p.parse(); } catch (e) { q = e.constructor.name + (e instanceof SyntaxError || e instanceof RangeError ? e.message : ""); } let t; try { t = text(q) + "|" + (p ? p.log + "," + text(p.state) : ""); } catch (e) { t = e.constructor.name; } return t; }
function all(title) { for (let i = 0; i < inputs.length; i++) out.push(title + i + " " + one(inputs[i])); }
const originals = {}; for (const C of [Scanner, State, Parser]) for (const k of Object.getOwnPropertyNames(C.prototype)) if (k !== "constructor") originals[C.name + "." + k] = C.prototype[k];
const back = () => { for (const C of [Scanner, State, Parser]) for (const k of Object.getOwnPropertyNames(C.prototype)) if (k !== "constructor" && originals[C.name + "." + k]) C.prototype[k] = originals[C.name + "." + k]; };
for (let round = 0; round < 3; round++) all("r" + round);
{ const old = Scanner.prototype.ctx; let n = 0; Scanner.prototype.ctx = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w0"); Scanner.prototype.ctx = old; all("o0"); }
{ const old = Scanner.prototype.ctx; delete Scanner.prototype.ctx; all("d0"); Scanner.prototype.ctx = old; all("e0"); }
{ const old = State.prototype.here; let n = 0; State.prototype.here = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w1"); State.prototype.here = old; all("o1"); }
{ const old = Scanner.prototype.at; let n = 0; Scanner.prototype.at = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w2"); Scanner.prototype.at = old; all("o2"); }
{ const old = Scanner.prototype.match; let n = 0; Scanner.prototype.match = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w3"); Scanner.prototype.match = old; all("o3"); }
{ const old = Scanner.prototype.match; delete Scanner.prototype.match; all("d3"); Scanner.prototype.match = old; all("e3"); }
{ const old = Scanner.prototype.eat; let n = 0; Scanner.prototype.eat = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w4"); Scanner.prototype.eat = old; all("o4"); }
{ const old = Scanner.prototype.update; let n = 0; Scanner.prototype.update = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w5"); Scanner.prototype.update = old; all("o5"); }
{ const old = Scanner.prototype.startNode; let n = 0; Scanner.prototype.startNode = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w6"); Scanner.prototype.startNode = old; all("o6"); }
{ const old = Scanner.prototype.startNode; delete Scanner.prototype.startNode; all("d6"); Scanner.prototype.startNode = old; all("e6"); }
{ const old = Scanner.prototype.finishNode; let n = 0; Scanner.prototype.finishNode = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w7"); Scanner.prototype.finishNode = old; all("o7"); }
{ const old = Scanner.prototype.finish; let n = 0; Scanner.prototype.finish = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w8"); Scanner.prototype.finish = old; all("o8"); }
{ const old = Scanner.prototype.next; let n = 0; Scanner.prototype.next = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w9"); Scanner.prototype.next = old; all("o9"); }
{ const old = Scanner.prototype.next; delete Scanner.prototype.next; all("d9"); Scanner.prototype.next = old; all("e9"); }
{ const old = Parser.prototype.atom; let n = 0; Parser.prototype.atom = function (...a) { if (++n === 9) throw new RangeError("nine"); return old.apply(this, a); }; all("w10"); Parser.prototype.atom = old; all("o10"); }
calls = 0; { Scanner.prototype.match = function (t) { return this.state.type == t; }; } all("b1"); stop = -1;
calls = 0; { const old = Scanner.prototype.finish; Scanner.prototype.finish = function (t, v) { calls += 0; return old.call(this, t, v); }; } all("b2"); stop = -1;
calls = 0; { State.prototype.here = function () { return new Position(this.line, 7); }; } all("b3"); stop = -1;
calls = 0; { Object.defineProperty(Token.prototype, "value", { set(v) { this.through = v; }, get() { return "up"; }, configurable: true }); } all("b4"); stop = -1;
calls = 0; { delete Scanner.prototype.ctx; Scanner.prototype.ctx = function () { return "x"; }; } all("b5"); stop = -1;
calls = 0; { Object.defineProperty(Position.prototype, "column", { value: 3, writable: false, configurable: true }); } all("b6"); stop = -1;
calls = 0; { Node.prototype.end = 5; } all("b7"); stop = -1;
calls = 0; { Object.defineProperty(Location.prototype, "end", { set(v) { this.late = v; }, configurable: true }); } all("b8"); stop = -1;
calls = 0; { globalThis.kept[4].prototype.update = function (p) { this.state.depth = p; }; } all("b9"); stop = -1;
calls = 0; { stop = 7; } all("b10"); stop = -1;
back(); all("z");
let h = 0; for (const line of out) { let k = 0; for (let i = 0; i < line.length; i++) k = (Math.imul(k, 31) + line.charCodeAt(i)) | 0; h ^= k; console.log(line.slice(0, 50), k); }
console.log(h);
