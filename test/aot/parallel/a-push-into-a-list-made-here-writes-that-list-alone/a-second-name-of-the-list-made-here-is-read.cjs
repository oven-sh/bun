"use strict";
// The list made here has a second name: it is read under the one while the other is pushed, past the room of its vector, so that the storage moves under the reads.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
const odd = veil(["9", 0.75, { valueOf() { return 5; } }]);
function whole(n) { const out = []; out.push(1, 2, 3); const d = out; let sum = 0; for (let i = 0; i < d.length && i < n; i++) { sum = (sum + d[i]) | 0; out.push((sum + i) & 1023); } return sum + "/" + d.length + "/" + out.length; }
function kinds(n) { const out = []; out.push(1, 2, 3); const d = out; let sum = 0; for (let i = 0; i < d.length && i < n; i++) { sum = (sum + d[i]) | 0; out.push(i === 4 ? odd[0] : i === 11 ? odd[1] : i === 12 ? odd[2] : (sum + i) & 1023); } return sum + "/" + d.length + "/" + out.length; }
function halves(n) { const out = []; out.push(0.5, 1.5, 2.5); const d = out; let sum = 0; for (let i = 0; i < d.length && i < n; i++) { sum += d[i]; out.push(sum / 4 + i); } return sum + "/" + d.length + "/" + out.length; }
function texts(n) { const out = []; out.push(1, 2, 3); const d = out; let sum = ""; for (let i = 0; i < d.length && i < n; i++) { sum = (sum + d[i]).slice(-24); out.push(i < 5 ? i : "t" + i); } return sum + "/" + d.length + "/" + out.length; }
for (let round = 0; round < 4; round++) { for (const n of [3, 8, 9, 40, 300, 2000]) said.push(whole(n), halves(n), texts(n), kinds(n)); }
console.log(said.join(" "));
