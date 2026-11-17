// The versions of an inner loop share the strings that are flattened in front of them: ropes, strings of both widths, positions out of bounds, other code between.
// STATISTIC: FlatStringsShared >= 1
"use strict";
let seen = 0, hook = null;
const change = (0, eval)("(x) => x");
function look(x) { seen += x; if (hook) hook(x); return x; }
function lower(ch) { if (ch >= 65 && ch <= 90) return 97 + (ch - 65); if (ch < 127) return ch; return String.fromCharCode(ch).toLowerCase().charCodeAt(0); }
function every(s, pred, start = 0, end = s.length) { for (let i = start; i < end; i++) { if (!pred(s.charCodeAt(i), i)) return false; } return true; }
function find(str, value, tail) { const n = str.length - value.length; for (let start = 0; start <= n; start++) { if (start === 5) look(start); if (every(value, (c, i) => lower(str.charCodeAt(i + start)) === c && tail.charCodeAt(i) !== 8364)) return start; } return -1; }
function lowerOrLook(ch) { return ch === 101 ? look(ch) : ch; }
function findNear(str, value, tail) { const n = str.length - value.length; for (let start = 0; start <= n; start++) { if (every(value, (c, i) => lowerOrLook(str.charCodeAt(i + start)) === c && i + start < 9)) return start; } return -1; }
function same(ch) { return ch; }
function findSame(str, value, tail) { const n = str.length - value.length; for (let start = 0; start <= n; start++) { if (start === 5) look(start); if (every(value, (c, i) => same(str.charCodeAt(i + start)) === c)) return start; } return -1; }
function scan(str, value, tail) { let t = 0; for (let s = 0; s < str.length; s++) { let i = 0; for (; i < value.length; i++) { if (lower(str.charCodeAt(i + s)) !== value.charCodeAt(i)) { t += look(i); break; } } t = t * 31 + i | 0; if (value[0] === tail[s]) t++; } return t; }
function count(list, value) { let t = 0; for (const w of list) for (let i = 0; i < w.length; i++) { for (let j = i; j < w.length; j++) { if (value.charCodeAt(j - i) === w.charCodeAt(j)) t++; if (w.charCodeAt(j) === 33) look(j); } } return t; }
const parts = ["create", "Type", "Checker", "for", "Program", "€uro", "", "e!", "ABC", "zzİz"];
function rope(k) { let s = parts[k % parts.length]; for (let i = 1; i < 4; i++) s = s + parts[(k * 7 + i * 3) % parts.length] + (k & 1 ? i : ""); return s; }
function show(f) { try { return String(f()); } catch (e) { return e.constructor.name; } }
const needles = ["program", "e", "", "checker1", "€", "zz"], lines = [];
for (let round = 0; round < 3; round++) {
  hook = round === 1 ? change((x) => { if (x === 2) throw new RangeError("two"); }) : round === 2 ? change((x) => { lines.push("h" + x); if (lines.length > 900) hook = null; }) : null;
  for (let k = 0; k < 10; k++) for (const needle of needles) { const s = rope(k), v = k % 3 ? needle : needle.slice(0, 1) + needle.slice(1), t = rope(k + 5); lines.push([k, needle, show(() => find(s, v, t)), show(() => findNear(s, v, t)), show(() => findSame(s, v, t)), show(() => scan(s, v, t)), show(() => count([s, v, t], v)), seen].join(" ")); }
}
console.log(lines.join("\n"));
