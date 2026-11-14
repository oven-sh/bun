// STATISTIC: StringsChosenOverBuiltins >= 1
// A value that is a string or an array, of which a loop uses a method that arrays lack.
"use strict";
const given = new Map([["text", "a table of characters"], ["wide", "é中😀"], ["list", ["t", "e", "x", "t"]], ["numbers", [1, 2, 3]], ["empty", ""], ["none", []], ["own", Object.assign(["q", "r"], { charCodeAt(i) { return 200 + i; } })]]);
function counts(t) { const c = new Array(16); for (let i = 0; i < 16; i++) c[i] = 0; for (let i = 0; i < t.length; i++) { const k = t.charCodeAt(i) & 15; c[k]++; if (c[k] > 2) c[0]++; } return c.join(); }
function points(t) { let s = 0; for (let i = 0; i < t.length; i++) s = (s * 31 + t.codePointAt(i)) | 0; return s; }
function upper(t) { let s = ""; for (let i = 0; i < t.length; i++) s += t.charAt(i).toUpperCase(); return s; }
function either(t) { let s = ""; for (let i = 0; i < t.length; i++) s += t[i] + t.indexOf(t[i]); return s; }
for (let round = 0; round < 3; round++) for (const [name, t] of given) for (const f of [counts, points, upper, either]) { let r; try { r = f(t); } catch (e) { r = e.constructor.name; } console.log(name, r); }
