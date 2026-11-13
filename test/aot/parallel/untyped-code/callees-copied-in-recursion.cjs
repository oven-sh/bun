// STATISTIC: CallsInlined >= 66
// A tokenizer under a parser whose functions call each other in cycles: constructors and small callees of few calls are copied where the call does not end its caller.
"use strict";
class Position { constructor(line, column) { this.line = line; this.column = column; } }
class Token { constructor(state) { this.type = state.type; this.value = state.value; this.start = new Position(state.line, state.start); this.end = state.end; } }
class Node { constructor(parser, type, start) { this.type = type; this.start = start; this.end = 0; if (parser.ranges) this.range = [start, 0]; } }
class State { constructor() { this.pos = 0; this.line = 1; this.start = 0; this.end = 0; this.type = ""; this.value = undefined; this.depth = 0; } }
class Tokenizer {
  constructor(input) { this.input = input; this.state = new State(); this.tokens = []; this.quiet = false; this.ranges = false; }
  code() { const c = this.input.charCodeAt(this.state.pos); if (c <= 0xd7ff || c >= 0xe000) return c; return (c << 10) + this.input.charCodeAt(this.state.pos + 1) - 0x35fdc00; }
  here() { return new Position(this.state.line, this.state.pos - this.state.start); }
  skip() { while (this.state.pos < this.input.length) { const c = this.input.charCodeAt(this.state.pos); if (c === 10) ++this.state.line; else if (c !== 32) break; ++this.state.pos; } }
  finish(type, value) { this.state.end = this.state.pos; this.state.endLoc = this.here(); this.state.type = type; this.state.value = value; }
  next() {
    if (!this.quiet) this.tokens.push(new Token(this.state));
    this.skip();
    this.state.start = this.state.pos;
    this.state.startLoc = this.here();
    if (this.state.pos >= this.input.length) return this.finish("eof");
    const c = this.code();
    if (c >= 48 && c <= 57) { let v = 0; for (let d; d = this.input.charCodeAt(this.state.pos), d >= 48 && d <= 57; ++this.state.pos) v = v * 10 + d - 48; return this.finish("num", v); }
    if (c >= 97 && c <= 122) { const from = this.state.pos; while (this.input.charCodeAt(this.state.pos) >= 97) ++this.state.pos; return this.finish("word", this.input.slice(from, this.state.pos)); }
    ++this.state.pos;
    return this.finish(String.fromCodePoint(c));
  }
  match(type) { return this.state.type === type; }
  eat(type) { if (!this.match(type)) return false; this.next(); return true; }
}
class Parser extends Tokenizer {
  node(type) { return new Node(this, type, this.state.start); }
  done(node) { node.end = this.state.end; if (node.range) node.range[1] = node.end; return node; }
  fail(what) { throw new SyntaxError(what + " at " + this.state.start + ", line " + this.state.line); }
  factor() {
    if (++this.state.depth > 40) this.fail("too deep");
    let node;
    if (this.match("num")) { node = this.node("num"); node.value = this.state.value; this.next(); }
    else if (this.match("word")) { node = this.node("name"); node.name = this.state.value; this.next(); if (this.eat("(")) node.list = this.list(")"); }
    else if (this.eat("(")) { node = this.sum(); if (!this.eat(")")) this.fail("no )"); }
    else if (this.eat("[")) { node = this.node("list"); node.list = this.list("]"); }
    else if (this.eat("-")) { node = this.node("negative"); node.of = this.factor(); }
    else this.fail("what");
    --this.state.depth;
    return this.done(node);
  }
  product() { let left = this.factor(); while (this.match("*") || this.match("/")) { const node = this.node(this.state.type); this.next(); node.left = left; node.right = this.factor(); left = this.done(node); } return left; }
  sum() { let left = this.product(); while (this.match("+") || this.match("-")) { const node = this.node(this.state.type); this.next(); node.left = left; node.right = this.product(); left = this.done(node); } return left; }
  list(end) { const list = []; while (!this.eat(end)) { if (list.length && !this.eat(",")) this.fail("no ,"); if (this.match("eof")) this.fail("open"); list.push(this.sum()); } return list; }
}
const texts = ["1 + 2 * (3 - x)", "f(1, [2, 3,\n 4], g()) / 7", "-(-1) * abc", "((((1", "2 *\n\n + 1", "[1, [2, [3, [4]]]]", "a b", "1 $ 2", "\u{1f600} + 1"];
function parse(text, prepare) { const p = new Parser(text); if (prepare) prepare(p); p.quiet = !!prepare; try { p.next(); const node = p.sum(); if (!p.match("eof")) p.fail("more"); return JSON.stringify(node) + p.tokens.length; } catch (e) { return e.constructor.name + ": " + e.message; } }
function run(prepare) { let hash = 0; const said = []; for (let i = 0; i < 40; ++i) { const s = parse(texts[i % texts.length], prepare); for (let k = 0; k < s.length; ++k) hash = (Math.imul(hash, 31) + s.charCodeAt(k)) | 0; if (i < texts.length) said.push(s.length > 90 ? s.slice(0, 60) + s.length : s); } return hash + " " + said.join(" | "); }
console.log(run());
console.log(run(p => { p.ranges = true; }));
console.log(run(p => { p.state.line = 2147483640; }));
console.log(run(p => { p.state.line = "1"; }));
console.log(run(p => { p.state.start = 0.5; }));
console.log(run(p => { Object.freeze(p.state); }));
console.log(run(p => { delete p.state.line; p.late = 1; }));
console.log(run(p => { p.here = () => ({ line: 0, column: -1 }); }));
console.log(run(p => { p.state = { __proto__: p.state, pos: 0 }; }));
let calls = 0;
const { here, code, match } = Tokenizer.prototype;
Tokenizer.prototype.code = function () { ++calls; return code.call(this); };
console.log(run(), calls);
Parser.prototype.here = function () { ++calls; return here.call(this); };
console.log(run(), calls);
Tokenizer.prototype.match = function (type) { if (++calls === 20000) throw new RangeError("enough"); return match.call(this, type); };
console.log(run(), calls);
Object.defineProperty(State.prototype, "line", { get() { return 7; }, set() { ++calls; } });
console.log(run(p => { delete p.state.line; }), calls);
