// Loops over a position that an escaped object holds: it is an integer, a fraction, beyond 32 bits, no number, missing, an accessor, and changes its kind in the middle.
"use strict";
const out = [];
class State { init(input) { this.input = input; this.pos = this.lineStart = 0; this.curLine = 1; this.word = ""; return this; } }
class Scanner {
  constructor(input) { this.state = new State().init(input); this.input = input; this.turns = 0; }
  skip() { while (this.state.pos < this.input.length) { const ch = this.input.charCodeAt(this.state.pos); if (ch === 32 || ch === 9) ++this.state.pos; else break; if (++this.turns > 60) break; } return this.state.pos; }
  lines() { while (this.state.pos < this.input.length) { const ch = this.input.charCodeAt(this.state.pos); if (ch === 10) { ++this.state.curLine; this.state.lineStart = this.state.pos; } this.state.pos += ch > 65535 ? 2 : 1; if (++this.turns > 60) break; } return this.state.curLine + ":" + this.state.lineStart; }
  word() { const start = this.state.pos; while (this.state.pos < this.input.length) { const ch = this.input[this.state.pos]; if (ch >= "a" && ch <= "z") this.state.pos += 1; else if (ch === "\\") { this.state.word += this.input.slice(start, this.state.pos); this.bump(); } else break; if (++this.turns > 60) break; } return this.state.word + this.input.slice(start, this.state.pos); }
  bump() { this.state.pos = this.state.pos + 2; }
  back() { let sum = 0; while (this.state.pos > 0) { sum = (sum * 31 + this.input.charCodeAt(--this.state.pos)) | 0; if (++this.turns > 60) break; } return sum; }
  far() { let n = 0; while (this.state.pos < this.state.end) { this.state.pos += this.state.step; if (++n > 50) break; } return this.state.pos; }
}
globalThis.kept = [State, Scanner];
const text = "   \t  some\\text with\nlines\n and more \\ words";
const show = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + e.message.slice(0, 40); } out.push(name + " " + (Object.is(r, -0) ? "-0" : String(r))); };
const values = { zero: 0, some: 6, minus: -3, zeroBelow: -0, fraction: 2.5, large: 2147483646, beyond: 2147483648, huge: 2 ** 53, nan: NaN, infinite: -Infinity, text: "4", nothing: undefined, empty: null, yes: true, big: 3n, object: { valueOf() { return 5; } }, list: [7] };
for (const name of Object.keys(values)) for (const way of ["skip", "lines", "word", "back"]) {
  const s = new Scanner(text); s.state.pos = values[name];
  show(name + " " + way, () => s[way]()); show(name + " " + way + " pos", () => s.state.pos); show(name + " again " + way, () => s[way]());
}
for (const [from, to, step] of [[0, 10, 1], [0, 10, 0.5], [2147483640, 2147483660, 3], [-5, 5, 2], [0, "9", 2], [1, 8, "1"], [0, 4, undefined], [2 ** 53 - 4, 2 ** 53 + 4, 1], [0, 3n, 1], [1n, 5n, 1n]]) {
  const s = new Scanner(text); s.state.pos = from; s.state.end = to; s.state.step = step; show("far " + String(from) + " " + String(to) + " " + String(step), () => s.far());
}
for (const way of ["skip", "lines", "word", "back"]) {
  const a = new Scanner(text); delete a.state.pos; show("deleted " + way, () => a[way]());
  const b = new Scanner(text); let n = 0; Object.defineProperty(b.state, "pos", { get() { return n; }, set(v) { n = v + 1; }, configurable: true }); show("accessor " + way, () => b[way]());
  const c = new Scanner(text); Object.freeze(c.state); show("frozen " + way, () => c[way]());
  const d = new Scanner(text); d.state = { pos: 1, lineStart: 0, curLine: 1, word: "" }; show("record " + way, () => d[way]());
  const e = new Scanner(text); e.input = { length: 5, charCodeAt(i) { if (i === 3) e.state.pos = 4.5; return 32; }, slice(...a) { return a.join(); }, 0: "a", 1: "b" }; show("changes " + way, () => e[way]()); show("changes pos " + way, () => e.state.pos);
  const f = new Scanner(text); f.state.pos = 3; Object.defineProperty(f, "input", { get() { if (f.turns === 2) f.state = new State().init(text); return text; } }); show("replaced " + way, () => f[way]());
}
for (const line of out) console.log(line);
