// STATISTIC: StepsOfIteratorsThatAreNeverMade >= 5
const n = JSON.parse("3"), log = [];
const make = () => { const m = new Map(); for (let i = 0; i < 4; i++) m.set("k" + i, i / 2); return m; };
{ const m = make();
  function run(p) { const o = []; for (let i = 0; i < n; i++) { const [a, b] = m.keys(); o.push(a, b, p); m.delete(a); } return o.join(); }
  console.log(run(0), m.size); }
{ const m = new Map(), turns = JSON.parse("12");
  function run(p) { const o = []; for (let i = 0; i < turns; i++) { m.set("k" + (i * 7 % 5), p); if (m.size > 3) { const k = m.keys().next().value; m.delete(k); o.push(k); } } return o.join() + [...m.keys()].join(); }
  console.log(run(1)); }
{ const m = make(), turns = JSON.parse("6");
  function run() { const o = []; for (let i = 0; i < turns; i++) { const k = m.keys().next().value; o.push(k); m.delete(k); const [again] = m.keys(); o.push(again); } return o.join(); }
  console.log(run(), m.size); }
{ const m = make(), turns = JSON.parse("40");
  function run() { let o = 0; for (let i = 0; i < turns; i++) { const [a, b] = m.keys(); o += a.length + b.length; m.delete(a); m.set("n" + i, i); m.set("o" + i, i); } return o; }
  console.log(run(), m.size, m.keys().next().value); }
{ const s = new Set(["a", "b", "c", "d"]);
  function run() { const o = []; for (let i = 0; i < n; i++) { const v = s.values().next().value; const [w, x] = s.keys(); o.push(v, w, x); s.delete(v); } return o.join(); }
  console.log(run(), s.size); }
