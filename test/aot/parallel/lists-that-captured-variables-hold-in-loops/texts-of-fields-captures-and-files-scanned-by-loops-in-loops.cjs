// Texts, lists and what turns from one into the other, held by fields, captures and names of the file, are scanned by a loop inside a loop.
"use strict";
const id = x => [x][JSON.parse("0")], out = [];
class Reader { constructor(src) { this.src = src; this.pos = 0; } ws() { for (;;) { const c = this.src[this.pos]; if (c === " " || c === 7) this.pos++; else if (c === "#") { while (this.pos < this.src.length && this.src[this.pos] !== "\n") this.pos++; } else return this; } } all() { let n = 0; while (this.pos < this.src.length) { this.ws(); this.pos++; n++; } return n; } }
function Old(src) { this.src = src; this.pos = 0; }
Old.prototype.ws = function () { for (;;) { var c = this.src.charAt ? this.src.charAt(this.pos) : this.src[this.pos]; if (c === " " || c === 7) this.pos++; else if (c === "#") { while (this.pos < this.src.length && this.src[this.pos] !== "\n") this.pos++; } else return this; } };
Old.prototype.all = function () { var n = 0; while (this.pos < this.src.length) { this.ws(); this.pos++; n++; } return n; };
let file = "", at = 0; function skip() { for (;;) { const c = file[at]; if (c === " ") at++; else if (c === "#") { while (at < file.length && file[at] !== "\n") at++; } else return at; } }
function scanner() { let held = "", p = 0; return { set(x) { held = x; p = 0; }, skip() { for (;;) { const c = held[p]; if (c === " ") p++; else if (c === "#") { while (p < held.length && held[p] !== "\n") p++; } else return p; } }, step() { p++; return p < held.length; } }; }
const values = ["a  b #x\n c", "", "# only", id("  wide \u0416 # y\nz "), [1, " ", 7, "#", "\n", 3], [], [" ", " "], new String("  s #\n"), { length: 2, 0: " ", 1: "q" }, new Uint8Array([7, 7, 1])];
const s = scanner();
for (let r = 0; r < 40; r++) { out.length = 0; for (const v of values) { for (const K of [Reader, Old]) { try { out.push(new K(v).all()); } catch (e) { out.push(e.name); } } file = v; at = 0; let n = 0; while (at < file.length) { n += skip(); at++; } out.push(n); s.set(v); n = 0; do n += s.skip(); while (s.step() && n < 999); out.push(n); } }
const changed = new Reader("  ab"); changed.ws(); changed.src = [" ", "x"]; changed.pos = 0; out.push(changed.all()); file = "  z"; at = 0; skip(); file = [" ", 1]; at = 0; out.push(skip());
console.log(out.join());
