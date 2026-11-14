// STATISTIC: FilledSlotGuardsHoisted <= 1
"use strict";
// The method that fills the fields is called before every other use of the new object, further on than the construction. Beside it, objects that others use first.
class Reader {
  reset(bytes) { this.bytes = bytes; this.offset = 0; this.count = 0; }
  sum() { let t = 0; while (this.offset < this.bytes.length) { t += this.bytes[this.offset]; this.offset++; } this.count++; return [t, this.offset, this.count]; }
}
function readAll(lists) {
  const reader = new Reader();
  const out = [];
  for (let i = 0; i < lists.length; i++) { reader.reset(lists[i]); out.push(reader.sum().join()); }
  return out.join(" ");
}
function readSome(list, first) {
  const reader = new Reader();
  if (!first) return "none";
  reader.reset(list);
  return reader.sum().join();
}
function Scanner() {}
Scanner.prototype.setInput = function (s) { this.s = s; this.i = 0; this.line = 1; };
Scanner.prototype.run = function () { let t = 0; while (this.i < this.s.length) { const c = this.s.charCodeAt(this.i); this.i++; if (c === 10) this.line++; t += c; } return [t, this.i, this.line].join(); };
function scan(text) { const scanner = new Scanner(); scanner.setInput(text); return scanner.run() + Object.keys(scanner).join(""); }
class Early { start(n) { this.n = n; } next() { let t = 0; while (this.n < 5) { this.n++; t += this.n; } return [String(this.n), t].join(); } }
function late(k) { const early = new Early(); for (let i = 0; i < k; i++) early.start(i); return early.next(); }
function thrown(k) { const early = new Early(); try { if (k > 1) throw new Error("k"); early.start(k); } catch (error) { return early.next() + error.message; } return early.next(); }
function kept(k) { const early = new Early(); const read = () => early.next(); let s = ""; for (let i = 0; i < k; i++) { s += read(); early.start(i); } return s; }
for (const lists of [[], [[]], [[1, 2, 3], [4], []], [new Uint8Array([7, 8]), [9]]]) console.log(readAll(lists), readSome(lists[0] ?? [1], lists.length > 1));
for (const text of ["", "ab\nc", "\n\n"]) console.log(scan(text));
for (const k of [0, 1, 2, 3]) console.log(late(k), thrown(k), kept(k));
