// Many lists born with room are kept, some filled past it, while the collector runs: each still holds what was put into it.
"use strict";
const kept = [];
function make(first, n) { const list = [first]; for (let i = 0; i < n; i++) list.push({ of: first, at: i }); return list; }
for (let round = 0; round < 40; round++) {
  for (let n = 0; n < 24; n++) kept.push(make(round * 100 + n, n));
  if (typeof Bun !== "undefined") Bun.gc(true);
  if (kept.length > 400) kept.splice(0, 200);
}
let sum = 0;
for (const list of kept) {
  for (let i = 1; i < list.length; i++) if (list[i].of !== list[0] || list[i].at !== i - 1) throw new Error("lost");
  sum += list.length;
}
console.log(kept.length, sum);
