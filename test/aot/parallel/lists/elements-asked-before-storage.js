"use strict";
// l[2] is asked for in front of the loop, and the list may hold boxed values: under proof checks that stopped where the storage was asked in the loop alone.
function pick(l, x) { return l[0] - 1 + l[2] * x; }
function both(l, a) { let t = 0; for (let i = 0; i < 12; i++) { if (i % 3) t += pick(l, i); else t -= pick(l, a); if (i === 6) l[2] = 7; } return t; }
function late(l, a) { let t = 0; for (let i = 0; i < 12; i++) { if (i % 3) t += pick(l, i); else t -= pick(l, a); if (i === 6) l[1] = "s" + i; } return t; }
function grown(l, a) { let t = 0; for (let i = 0; i < 9; i++) { if (i % 2) t += pick(l, i); else t -= pick(l, a); if (i === 5) l[0] = 0.5; if (i === 6) l[7] = 1; } return t; }
const texts = ["[1,null,3,4]", "[1,2,3,4]", "[0.5,1,2.5]", "[1,\"s\",3.5]", "[null,1,3]", "[1,2,null]", "[1]", "[1.5]", "[]", "[1,2,\"x\"]"];
for (const run of [both, late, grown]) {
  const out = [];
  for (const text of texts) { let s; try { s = String(run(JSON.parse(text), 0)); } catch (e) { s = e.constructor.name; } out.push(s); }
  const holed = [1, , 3]; out.push(run(holed, 2), run([1, 2], 1), run(new Array(3).fill(2), 1), run([1, , 2.5], 0.5));
  console.log(out.join());
}
