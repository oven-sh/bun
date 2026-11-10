// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=3
// THE RED CONTROL OF Walker::isOtherThanRestOf(): with its last line turned to "another" this program gives wrong numbers: as built it looks right.
// The push brings a text, a boolean, null or a record that is written in the turn itself: it runs no other code and changes the kind of the storage at once. What is read and reckoned with as a number is the same list, come back through a veil, chosen by a condition, or out of a record.
"use strict";
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
const stranger = JSON.parse("[" + Array.from({ length: 50 }, (_, i) => i + 1).join() + "]");
function text(n) { const out = []; out.push(1, 2, 3); const d = veil(out); let sum = 0; for (let i = 0; i < d.length && i < n; i++) { sum = (sum + d[i]) | 0; out.push("7"); } return sum + "/" + d.length; }
function truth(n) { const out = []; out.push(1, 2, 3); const d = veil(out); let sum = 0; for (let i = 0; i < d.length && i < n; i++) { sum = (sum + d[i]) | 0; out.push(true); } return sum + "/" + d.length; }
function nothing(n) { const out = []; out.push(0.5, 1.5); const d = veil(out); let sum = 0; for (let i = 0; i < d.length && i < n; i++) { sum += d[i]; out.push(null); } return sum + "/" + d.length; }
function record(n) { const out = []; out.push(1, 2, 3); const d = veil(out); let sum = 0; for (let i = 0; i < d.length && i < n; i++) { sum = (sum + d[i] * 2) | 0; out.push({ i }); } return sum + "/" + d.length; }
function chosen(n) { const out = []; out.push(1, 2, 3); const d = n % 3 ? out : stranger; let sum = 0; for (let i = 0; i < d.length && i < n; i++) { sum = (sum + d[i]) | 0; out.push("7"); } return sum + "/" + d.length; }
function kept(n) { const out = []; out.push(1, 2, 3); const h = veil({ l: out }), d = h.l; let sum = 0; for (let i = 0; i < d.length && i < n; i++) { sum = (sum + d[i]) | 0; out.push("7"); } return sum + "/" + d.length; }
for (let round = 0; round < 3; round++) { for (const n of [1, 3, 4, 5, 8, 9, 40, 300]) said.push(text(n), truth(n), nothing(n), record(n), chosen(n), kept(n)); }
console.log(said.join(" "));
