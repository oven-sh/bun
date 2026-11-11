// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=3
// One of the two lists that the loop reads is the list that it fills, under another name: through a veil, a holder, a closure; texts and fractions are pushed among whole numbers while the other name is read as numbers.
"use strict";
const veil = value => JSON.parse("0", () => value);
const said = [];
function byVeil(right, n) { const out = [1, 2, 3]; const seen = veil(out); let a = 0, b = 0; while (a < seen.length && b < right.length && out.length < n) out.push(seen[a] <= right[b] ? seen[a++] : right[b++]); return out.join() + "/" + seen.length; }
function byHolder(right, n) { const out = [1, 2, 3]; const holder = { seen: out }; let a = 0, b = 0; while (a < holder.seen.length && b < right.length && out.length < n) out.push(holder.seen[a] <= right[b] ? holder.seen[a++] : right[b++]); return out.join(); }
function byClosure(right, n) { const out = [1, 2, 3]; const seen = () => out; let a = 0, b = 0; while (a < seen().length && b < right.length && out.length < n) out.push(seen()[a] <= right[b] ? seen()[a++] : right[b++]); return out.join(); }
function itself(right, n) { const out = [1, 2, 3]; let a = 0, b = 0; while (a < out.length && b < right.length && out.length < n) out.push(out[a] <= right[b] ? out[a++] : right[b++]); return out.join(); }
const table = { byVeil, byHolder, byClosure, itself };
const rights = JSON.parse('[[0,2,4,6,8,10,12,14],[0.5,2.5,4.5,6.5],["0","2","a","b"],[5,"x",0.25,7,8,9]]');
for (let turn = 0; turn < 3; turn++) for (const name of JSON.parse('["byVeil","byHolder","byClosure","itself"]')) for (const right of rights) for (const n of [3, 6, 40]) said.push(table[name](right, n));
console.log(said.join(" | "));
