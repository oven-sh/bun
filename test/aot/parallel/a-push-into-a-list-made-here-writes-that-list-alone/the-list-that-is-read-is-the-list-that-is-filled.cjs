"use strict";
// The list made here is read by index in the same loop that pushes into it, pops, shifts or unshifts it: its length and its vector change under the reads: under its own name, under a second name, out of a field, and handed in by the caller.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function grows() { const q = [1, 2, 3]; let s = 0; for (let i = 0; i < q.length; i++) { s = (s + q[i]) | 0; if (q.length < 300) q.push(q[i] + 1); } return s + " " + q.length; }
function growsDoubles() { const q = [0.5, 1.5]; let s = 0; for (let i = 0; i < q.length; i++) { s += q[i]; if (q.length < 300) q.push(q[i] + 0.25, i); } return s + " " + q.length; }
function alias() { const out = [], same = out; let s = 0; for (let i = 0; i < 300; i++) { out.push(i * 3); s = (s + same[i] + same.length) | 0; } return s; }
function field() { const out = [], holder = { list: out }; let s = 0; for (let i = 0; i < 300; i++) { out.push(i * 3); s = (s + holder.list[i]) | 0; } return s; }
function pops() { const q = []; for (let i = 0; i < 300; i++) q.push(i); let s = 0; for (let i = 0; i < q.length; i++) { s = (s + q[i]) | 0; q.pop(); } return s + " " + q.length; }
function shifts() { const q = []; for (let i = 0; i < 300; i++) q.push(i); let s = 0; for (let i = 0; i < q.length; i++) { s = (s + q[i]) | 0; q.shift(); } return s + " " + q.length; }
function unshifts() { const q = [1]; let s = 0; for (let i = 0; i < q.length && i < 200; i++) { s = (s + q[i]) | 0; q.unshift(i); } return s + " " + q.length; }
function window(d) { const recent = []; let total = 0, best = 0; for (let i = 0; i < d.length; i++) { recent.push(d[i]); total += d[i]; if (recent.length > 5) total -= recent.shift(); if (total > best) best = total; if (recent[0] > recent[recent.length - 1]) best += 0.5; } return best; }
function handed(d, out) { let s = 0; for (let i = 0; i < d.length && i < 300; i++) { out.push(d[i]); s = (s + d[i]) | 0; } return s + " " + d.length; }
for (let round = 0; round < 3; round++) {
    said.push(grows(), growsDoubles(), alias(), field(), pops(), shifts(), unshifts(), window(JSON.parse("[" + Array.from({ length: 64 }, (_, i) => (i * 53 % 97) / 4).join() + "]")));
    const one = JSON.parse("[1,2,3]"); said.push(handed(one, one), handed(JSON.parse("[1,2,3]"), []), handed(veil([4, 5]), veil([])));
}
console.log(said.join(" "));
