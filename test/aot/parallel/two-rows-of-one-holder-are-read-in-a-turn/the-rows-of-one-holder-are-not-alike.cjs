// The guess is that rows of one holder are alike. Here they are not: contiguous, whole numbers, doubles, holes, texts, views, array-likes, null stand side by side, and rows change their storage under the loop.
"use strict";
function dist(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }
function go(p, t) { let s = 0; for (let i = 0; i < p.length; i++) { const d = dist(p[i], p[(i + t) % p.length]); s = (s * 31 + (d === d ? d * 2 : 7)) % 1000003; } return s; }
const unknown = JSON.parse("[3,4]");
const kinds = [[unknown[0], unknown[1]], [1, 2], [1.5, 2.5], [unknown[0], 7], [5, , 6], [unknown[1], "8"], [true, null]];
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name); } }
for (let t = 0; t < 200; t++) go(kinds, t);
for (let t = 0; t < kinds.length; t++) tell(() => go(kinds, t));
const odd = [[unknown[0], 1], "ab", new Uint8Array([9, 10]), { 0: 1, 1: 2 }, [unknown[1], 2]];
for (let t = 0; t < odd.length; t++) tell(() => go(odd, t));
tell(() => go([[unknown[0], 1], null], 1));
const changing = [[unknown[0], 1], [unknown[1], 2], [unknown[0], 3]];
tell(() => go(changing, 1));
changing[1][0] = 0.5; changing[2] = [1, 2]; changing[0].length = 1;
tell(() => go(changing, 1));
Object.defineProperty(changing[1], 1, { get() { changing[2] = ["x", "y"]; return 4; } });
tell(() => go(changing, 1)); tell(() => go(changing, 2));
console.log(said.join(" | "));
