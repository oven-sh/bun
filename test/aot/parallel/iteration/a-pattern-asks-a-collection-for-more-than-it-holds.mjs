// STATISTIC: StepsOfIteratorsThatAreNeverMade >= 4
const n = JSON.parse("3"), log = [];
const make = () => { const m = new Map(); for (let i = 0; i < 4; i++) m.set("k" + i, i / 2); return m; };
{ const m = make();
  function run(p) { const o = []; for (let i = 0; i < n; i++) { const [a, b, c, d, e] = m.values(); o.push(a, b, c, d, e, p); m.set("k" + i, p); } return o.join(); }
  console.log(run("x"), run(1)); }
{ const l = [1, "p", 2.5, , "x"];
  function run() { const o = []; for (let i = 0; i < n; i++) { const [a, b, c, d, e, f] = l.values(); o.push(a, b, c, d, e, f); l.shift(); } return o.join(); }
  console.log(run(), l.length); }
{ const m = new Map([[undefined, 1], ["p", undefined]]);
  function run() { const o = []; for (let i = 0; i < n; i++) { const [a = "d", b = "e"] = m.keys(); const [c, e = "f"] = m.values(); o.push(a, b, c, e, String(m.keys().next().value)); } return o.join(); }
  console.log(run()); }
{ const m = new Map(), s = new Set();
  function run(p) { const o = []; for (let i = 0; i < n; i++) { const [a] = m.keys(), [b] = s.values(); o.push(a, b, m.keys().next().value, s.values().next().value, p); } return o.join(); }
  console.log(run(1)); }
