// STATISTIC: FilledSlotGuardsHoisted >= 4
"use strict";
// Loops update fields that another method fills. One version of the loop begins where they are found filled.
class State { init(input) { this.input = input; this.pos = this.line = 0; this.type = null; } }
class Tokens {
  constructor(input, begins) { this.state = new State(); if (begins) this.state.init(input); this.input = input; }
  word() { let n = 0; while (this.state.pos < this.input.length) { const c = this.input.charCodeAt(this.state.pos); if (c === 32) break; this.state.pos += 1; n += c; } return n; }
  skip() { while (this.state.pos < this.input.length && this.input.charCodeAt(this.state.pos) === 32) ++this.state.pos; }
  all() { let s = 0, rounds = 0; while (this.state.pos < this.input.length && rounds++ < 50) { this.skip(); this.state.type = "w"; s += this.word(); this.state.line++; } return [s, this.state.pos, this.state.line, this.state.type]; }
  back() { let n = 0; while (this.state.pos > 0) { this.state.pos -= 1; if (this.input[this.state.pos] === "e") n++; } return [n, this.state.pos]; }
}
class Lexer {
  open(text) { this.text = text; this.pos = 0; this.count = 0; return this; }
  skip() { while (this.pos < this.text.length && this.text.charCodeAt(this.pos) === 32) this.pos++; }
  word() { let n = 0; while (this.pos < this.text.length) { const c = this.text.charCodeAt(this.pos); if (c === 32) break; this.pos++; n += c; } this.count++; return n; }
  all() { let sum = 0; while (this.pos < this.text.length) { this.skip(); sum += this.word(); } return [sum, this.pos, this.count]; }
}
class Cursor {
  open(rows) { this.rows = rows; this.at = 0; this.sum = 0; return this; }
  next() { return this.at < this.rows.length ? this.rows[this.at++] : -1; }
  drain() { for (let v; (v = this.next()) >= 0;) this.sum += v; return [this.sum, this.at]; }
}
function Scanner() {}
Scanner.prototype.setInput = function (s) { this.s = s; this.i = 0; this.line = 1; return this; };
Scanner.prototype.peek = function () { return this.s.charCodeAt(this.i); };
Scanner.prototype.read = function () { const c = this.s.charCodeAt(this.i++); if (c === 10) this.line++; return c; };
Scanner.prototype.run = function () { let t = 0; while (this.i < this.s.length) { if (this.peek() === 32) { this.read(); continue; } t += this.read(); } return [t, this.i, this.line]; };
class Steps { begin(n) { this.n = n; } up(k) { for (let i = 0; i < k; i++) this.n++; return this.n; } down(k) { for (let i = 0; i < k; i++) this.n -= 1; return this.n; } both(other, k) { for (let i = 0; i < k; i++) { this.n++; other.n += 1; } return [this.n, other.n]; } }
const show = (f) => { try { return JSON.stringify(f(), (k, v) => (typeof v === "number" && (v !== v || Object.is(v, -0) || Math.abs(v) === Infinity) ? (Object.is(v, -0) ? "-0" : String(v)) : v === undefined ? "undefined" : v)); } catch (error) { return error.constructor.name; } };
const texts = ["", "one", "let  alpha beta  12 gamma ", " ", "é\u{1f600} e", "e".repeat(40) + " x\ny\n z"];
for (let round = 0; round < 2; round++) {
  for (const text of texts) {
    const tokens = new Tokens(text, true);
    console.log(round, text.length, show(() => tokens.all()), show(() => tokens.back()), show(() => tokens.word()), show(() => new Lexer().open(text).all()), show(() => new Scanner().setInput(text).run()));
  }
  console.log(show(() => new Cursor().open([1, 2, 3]).drain()), show(() => new Cursor().open([1, 2.5, "3", 4]).drain()), show(() => new Cursor().open([]).drain()));
  // Nobody has filled the fields.
  const empty = new Tokens("ab c", false);
  console.log(show(() => empty.word()), show(() => empty.skip()), show(() => empty.back()), show(() => empty.all()), Object.keys(empty.state).join());
  console.log(show(() => new Lexer().word()), show(() => new Scanner().run()), show(() => new Cursor().next()), show(() => new Steps().up(2)), show(() => new Steps().down(0)));
  for (const n of [0, 1.5, -0, NaN, Infinity, 2147483645, -2147483646, 2 ** 53 - 1, 1e300, 0.1]) {
    const steps = new Steps(), other = new Steps();
    steps.begin(n); other.begin(0);
    console.log(String(n), show(() => steps.up(5)), show(() => steps.down(9)), show(() => steps.both(other, 3)), show(() => steps.both(steps, 2)), show(() => steps.up(0)), Object.is(steps.n, -0));
    other.begin(n);
    console.log(show(() => new Steps().both(other, 2)), show(() => other.both(new Steps(), 2)));
  }
}
