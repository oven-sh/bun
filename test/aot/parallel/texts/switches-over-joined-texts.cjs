// Joined, cut, flat and wide texts of every length around the shortest and the longest case, in switches of two, three and eight cases.
"use strict";
const out = [], un = v => [v][JSON.parse("0")], A = un("abcdefghijklmnopqrstuvwxyz".repeat(6));
function two(x) { switch (x) { case "abc": return 1; case "abcdefgh": return 2; default: return 0; } }
function three(x) { switch (x) { case "": return 1; case "a": return 2; case "abcdefghijk": return 3; default: return 0; } }
function same(x) { switch (x) { case "abcd": return 1; case "abce": return 2; case "xbcd": return 3; default: return 0; } }
function eight(x) { switch (x) { case "ab": return 1; case "abcde": return 2; case "abcdef": return 3; case "abcdefghijklmnopq": return 4; case "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz": return 5; case "ac": return 6; case "abcdg": return 7; case "b": return 8; default: return 0; } }
function wide(x) { switch (x) { case "ab\u4e2d": return 1; case "abc": return 2; case "abcd": return 3; default: return 0; } }
const asks = [two, three, same, eight, wide];
for (let r = 0; r < 3; r++) { out.length = 0; for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18, 63, 64, 127, 128, 129, 130, 131, 150]) { const t = A.slice(0, n), h = n >> 1; let s = ""; for (const x of [t, t.slice(0, h) + t.slice(h), t.slice(0, 1) + t.slice(1, h) + t.slice(h), ("x" + t).slice(1), t.slice(0, -1) + un("\u4e2d"), (t + un("\u4e2d")).slice(0, n), (un("\u4e2d") + t).slice(1), `${t.slice(0, h)}${t.slice(h)}`, "x" + t.slice(1), t + ""]) for (let i = 0; i < asks.length; i++) s += asks[i](x); out.push(n + ":" + s); } for (const v of [0, null, undefined, true, 5n, {}, ["abc"], new String("abc"), () => 1]) { let s = ""; for (let i = 0; i < asks.length; i++) s += asks[i](v); out.push(s); } }
console.log(out.join("\n"));
