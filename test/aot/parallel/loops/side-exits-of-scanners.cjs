// Scanners whose loops run other code on side paths, in nested iterations: the code swaps, freezes and changes what the loops hold.
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
const inputs = ["foo bar_1 (a b) # note\n x\\y", "(x (y z) w)\n  caf\u00e9 9z\n", "a\\b\\c\\d ee ff\n# one\n# two\n g", "\ud83d\ude00 ((q)) +", "(", "", "long_word another\\word $x ( p\\q ) # end"];
function one(input) { let p, q; try { p = new Parser(input); q = p.parse(); } catch (e) { q = e.constructor.name + (e instanceof SyntaxError || e instanceof RangeError ? e.message : ""); } let t; try { t = text(q) + "|" + (p ? p.log + "," + text(p.state) : ""); } catch (e) { t = e.constructor.name; } return t; }
function all(title) { for (let i = 0; i < inputs.length; i++) out.push(title + i + " " + one(inputs[i])); }
for (let round = 0; round < 3; round++) all("r" + round);
calls = 0; globalThis.hook = (s, n) => {  };
all("h0");
calls = 0; globalThis.hook = (s, n) => { if (n === 4) s.state = s.state.copy(); };
all("h1");
calls = 0; globalThis.hook = (s, n) => { if (n === 3) Object.freeze(s.state.context); };
all("h2");
calls = 0; globalThis.hook = (s, n) => { if (n === 5) s.at = function () { return this.input.charCodeAt(this.state.pos); }; };
all("h3");
calls = 0; globalThis.hook = (s, n) => { if (n === 2) s.state = Object.assign(Object.create(State.prototype), s.state); };
all("h4");
calls = 0; globalThis.hook = (s, n) => { if (n === 3) { let v = s.state.line; Object.defineProperty(s.state, "line", { get() { return v; }, set(x) { v = x + 1; }, configurable: true, enumerable: true }); } };
all("h5");
calls = 0; globalThis.hook = (s, n) => { if (n === 4) s.state.pos = s.state.pos + 0.5; };
all("h6");
calls = 0; globalThis.hook = (s, n) => { if (n === 6) s.input = s.input + " zz"; };
all("h7");
calls = 0; globalThis.hook = (s, n) => { if (n === 3) delete s.state.lineStart; };
all("h8");
calls = 0; globalThis.hook = (s, n) => { if (n % 3 === 0) s.state.extra = n; };
all("h9");
calls = 0; globalThis.hook = (s, n) => { if (n === 4) Object.preventExtensions(s.state); };
all("h10");
calls = 0; globalThis.hook = (s, n) => { if (n === 2) s.state = { ...s.state, here() { return "here"; }, ctx: State.prototype.ctx, copy: State.prototype.copy }; };
all("h11");
calls = 0; {  } all("b0");
calls = 0; { Scanner.prototype.match = function (t) { return this.state.type == t; }; } all("b1");
calls = 0; { const old = Scanner.prototype.finish; Scanner.prototype.finish = function (t, v) { calls += 0; return old.call(this, t, v); }; } all("b2");
calls = 0; { State.prototype.here = function () { return new Position(this.line, 7); }; } all("b3");
calls = 0; { Object.defineProperty(Token.prototype, "value", { set(v) { this.through = v; }, get() { return "up"; }, configurable: true }); } all("b4");
calls = 0; { delete Scanner.prototype.ctx; Scanner.prototype.ctx = function () { return "x"; }; } all("b5");
calls = 0; { Object.defineProperty(Position.prototype, "column", { value: 3, writable: false, configurable: true }); } all("b6");
calls = 0; { Node.prototype.end = 5; } all("b7");
calls = 0; { Object.defineProperty(Location.prototype, "end", { set(v) { this.late = v; }, configurable: true }); } all("b8");
calls = 0; { globalThis.kept[4].prototype.update = function (p) { this.state.depth = p; }; } all("b9");
calls = 0; { stop = 7; } all("b10");
let h = 0; for (const line of out) { let k = 0; for (let i = 0; i < line.length; i++) k = (Math.imul(k, 31) + line.charCodeAt(i)) | 0; h ^= k; console.log(line.slice(0, 60), k); }
console.log(h);
