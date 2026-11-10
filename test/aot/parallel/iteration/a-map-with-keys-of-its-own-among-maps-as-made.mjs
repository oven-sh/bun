// STATISTIC: IteratorAllocationsElidedInSteps >= 1
const n = JSON.parse("3"), log = [];
const make = () => { const m = new Map(); for (let i = 0; i < 4; i++) m.set("k" + i, i / 2); return m; };
{ const maps = [make(), make(), make()]; maps[1].keys = () => { log.push("own"); return ["q", 7][Symbol.iterator](); };
  function run() { const o = []; for (let i = 0; i < n; i++) { const [a, b] = maps[i].keys(); o.push(a, b); o.push(maps[i].keys().next().value); } return o.join(); }
  console.log(run(), log.join()); }
{ class Odd extends Map { keys() { log.push("below"); return super.keys(); } } const maps = [make(), new Odd([["z", 1]]), make()];
  function run() { const o = []; for (let i = 0; i < n; i++) { const [a] = maps[i].keys(); o.push(a, maps[i].keys().next().value); } return o.join(); }
  console.log(run(), log.join()); }
