"use strict";
// A shift or an unshift of a long list changes the very kind of its storage (the engine goes over to a storage with a header of its own from ten thousand places on). The list is made here; what is read is the same list, come back through a veil, chosen by a condition, or out of a record.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
const stranger = JSON.parse("[" + Array.from({ length: 50 }, (_, i) => i + 1).join() + "]");
function shifted(n, turns) { const out = []; for (let i = 0; i < n; i++) out.push(i & 255); const d = veil(out); let sum = 0; for (let i = 0; i < d.length && i < turns; i++) { sum = (sum + d[i]) | 0; out.shift(); } return sum + "/" + d.length; }
function shiftedHalves(n, turns) { const out = []; for (let i = 0; i < n; i++) out.push(i + 0.5); const d = veil(out); let sum = 0; for (let i = 0; i < d.length && i < turns; i++) { sum += d[i]; out.shift(); } return sum + "/" + d.length; }
function unshifted(n, turns) { const out = []; for (let i = 0; i < n; i++) out.push(i & 255); const d = veil(out); let sum = 0; for (let i = 0; i < d.length && i < turns; i++) { sum = (sum + d[i]) | 0; out.unshift(i); } return sum + "/" + d.length; }
function chosen(n, turns) { const out = []; for (let i = 0; i < n; i++) out.push(i & 255); const d = n % 3 ? out : stranger; let sum = 0; for (let i = 0; i < d.length && i < turns; i++) { sum = (sum + d[i]) | 0; out.shift(); } return sum + "/" + d.length; }
function kept(n, turns) { const out = []; for (let i = 0; i < n; i++) out.push(i & 255); const h = veil({ l: out }), d = h.l; let sum = 0; for (let i = 0; i < d.length && i < turns; i++) { sum = (sum + d[i]) | 0; out.shift(); } return sum + "/" + d.length; }
for (let round = 0; round < 3; round++) { for (const n of [5, 100, 9999, 10001, 12000, 12002, 30000]) said.push(shifted(n, 60), shiftedHalves(n, 60), unshifted(n, 60), chosen(n, 60), kept(n, 60)); }
console.log(said.join(" "));
