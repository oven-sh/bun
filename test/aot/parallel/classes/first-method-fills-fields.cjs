// STATISTIC: FilledSlotGuardsHoisted <= 2
"use strict";
// The first method that is called on each new object fills the fields: no reader finds them empty.
class State { init(input) { this.input = input; this.pos = this.line = 0; this.type = null; } }
class Tokens {
  constructor(input) { this.state = new State(); this.state.init(input); this.input = input; }
  word() { let n = 0; while (this.state.pos < this.input.length) { const c = this.input.charCodeAt(this.state.pos); if (c === 32) break; this.state.pos += 1; n += c; } return n; }
  skip() { while (this.state.pos < this.input.length && this.input.charCodeAt(this.state.pos) === 32) ++this.state.pos; }
  all() { let s = 0; while (this.state.pos < this.input.length) { this.skip(); this.state.type = "w"; s += this.word(); this.state.line++; } return [s, this.state.pos, this.state.line, this.state.type]; }
}
class Lexer {
  open(text) { this.text = text; this.pos = 0; this.count = 0; return this; }
  skip() { while (this.pos < this.text.length && this.text.charCodeAt(this.pos) === 32) this.pos++; }
  word() { let n = 0; while (this.pos < this.text.length) { const c = this.text.charCodeAt(this.pos); if (c === 32) break; this.pos++; n += c; } this.count++; return n; }
  all() { let sum = 0; while (this.pos < this.text.length) { this.skip(); sum += this.word(); } return [sum, this.pos, this.count]; }
}
function Scanner() {}
Scanner.prototype.setInput = function (s) { this.s = s; this.i = 0; this.line = 1; return this; };
Scanner.prototype.run = function () { let t = 0; while (this.i < this.s.length) { const c = this.s.charCodeAt(this.i); this.i++; if (c === 10) this.line++; t += c; } return [t, this.i, this.line]; };
class Parser {
  parse(tokens) { this.tokens = tokens; this.pos = 0; this.depth = 0; return this.sum(); }
  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }
  sum() { let v = this.product(); while (this.peek() === "+") { this.next(); v += this.product(); } return v; }
  product() { let v = this.atom(); while (this.peek() === "*") { this.next(); v *= this.atom(); } return v; }
  atom() { const t = this.next(); if (t === "(") { this.depth++; const v = this.sum(); this.next(); this.depth--; return v; } return +t; }
}
for (const text of ["", "one", "let  alpha beta  12 gamma ", " ", "e".repeat(40) + " x\ny\n z"]) {
  const scanner = new Scanner();
  scanner.setInput(text);
  console.log(text.length, JSON.stringify(new Tokens(text).all()), JSON.stringify(new Lexer().open(text).all()), JSON.stringify(scanner.run()));
}
for (const text of ["1", "1 + 2 * 3", "( 1 + 2 ) * 3", "( ( 4 ) )"]) {
  const parser = new Parser();
  console.log(parser.parse(text.split(" ")), parser.pos, parser.depth, Object.keys(parser).join());
}
