// STATISTIC: CharactersReadPastLengths >= 2
// Characters of strings under counters that go down from past their lengths: undefined there, as in front of the string.
"use strict";
const given = new Map([["text", "a table of characters"], ["short", "ab"], ["empty", ""], ["wide", "中😀z"], ["list", ["a", "b"]], ["object", { length: 2, 0: "a", 1: "b" }], ["number", 5]]);
const masks = new Map([["few", { a: 3, b: 5, t: 9 }], ["none", { }], ["getter", { get a() { return 7; }, undefined: 1 }], ["nullish", null]]);
function search(text, mask, n) { const bits = Array(n + 2); bits[n + 1] = 1; let found = -1; for (let j = n; j >= 1; j -= 1) { const match = mask[text[j - 1]]; bits[j] = (bits[j + 1] << 1 | 1) & match; if (bits[j] & 4) found = j; } return found + ":" + bits.join(); }
function join(text, from) { let s = ""; for (let i = from; i >= -2; i--) s += text[i] + ","; return s; }
function count(text, from, c) { let s = 0, u = 0; for (let i = Math.min(from, text.length) + 3; i--;) { const x = text[i]; if (x === undefined) u++; else if (x === c) s++; } return s + ":" + u; }
function until(text, from) { let i = from; for (; i > 0; i--) if (text[i] !== undefined) break; return i; }
function stepped(text, from) { let s = ""; for (let i = from; i > 0; i -= 2) { const x = text[i]; if (x > "b") s += x; if (x === undefined) i++; } return s; }
for (let round = 0; round < 3; round++) for (const [name, t] of given) {
  const lines = [];
  for (const [m, mask] of masks) { try { lines.push(m + search(t, mask, 9 + round)); } catch (e) { lines.push(m + e.constructor.name); } }
  for (const f of [() => join(t, 6 + round), () => count(t, 4, "a"), () => count(t, 40, "t"), () => until(t, 30), () => stepped(t, 25), () => join(t, 2.5), () => join(t, -1)]) { try { lines.push(f()); } catch (e) { lines.push(e.constructor.name); } }
  console.log(name, lines.join(" | "));
}
