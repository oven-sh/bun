const n = JSON.parse("3"), log = [];
const make = () => { const m = new Map(); for (let i = 0; i < 4; i++) m.set("k" + i, i / 2); return m; };
{ const m = make();
  function run() { const o = []; for (let i = 0; i < n; i++) { const it = m.keys(); const a = it.next().value; const b = it.next().value; const [c] = it; o.push(a, b, c, it.next().value); } return o.join(); }
  console.log(run()); }
