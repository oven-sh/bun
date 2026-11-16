// A running sum over rows that lack a field, where a delete stands between the two reads of the row.
function q() { const all = []; const f = R => { let s = 0; R.filter(p => { const z = p.late; delete p.b; s += p.a + z; return p.a; }); return s; }; for (let c = 0; c < 4; c++) all.push(f(c < 2 ? [{ a: 3 }, { a: 2, b: 1, q9: 1 }, { a: [1], b: 1 }] : [{ a: 2.5, b: 1 }])); return all; }
const IN = {
  m() { return { p: 1, t: "a", n: 1, m: 1, a: [1] }; },
};
for (let t = 0; t < 60; t++) { console.log(t + " " + q(IN.m())); }
