// Pushes of one to four at every distance from the end of the storage, with lists beside them that must not change.
"use strict";
const out = [], hide = v => [v][JSON.parse("0")], P = [(a, i) => a.push(i), (a, i) => a.push(i, -i), (a, i) => a.push(i, -i, i), (a, i) => a.push(i, -i, i, -i)];
for (const t of ["[]", "[1]", '["a"]', "[0.5]", "[1,2,3]", '[null,1]']) for (let start = 0; start < 18; start++) for (const p of P) {
  const before = JSON.parse('["x","y","z"]'), a = JSON.parse(t), after = JSON.parse('[9,8,7]'), o = { k: 1, l: "m" }; for (let i = 0; i < start; i++) a.push(i);
  for (let i = 1; i < 14; i++) { const n = a.length, r = hide(p)(a, i); if (r !== a.length || a[n] !== i || (r > n + 1 && a[n + 1] !== -i)) out.push("BAD" + t + start + i); }
  a.length = 5; a.length = 9; if (5 in a || 8 in a) out.push("HOLE"); hide(p)(a, 3); out.push(a.length, a.lastIndexOf(3)); if (before.join() + after.join() + o.k + o.l !== "x,y,z9,8,71m") out.push("BESIDE");
}
let h = 7; for (const x of out) for (const c of String(x)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; console.log(out.length, h, out.filter(x => typeof x === "string").length);
