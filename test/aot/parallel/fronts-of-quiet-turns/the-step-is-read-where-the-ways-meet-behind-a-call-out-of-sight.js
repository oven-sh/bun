const outside = JSON.parse("{}");
function walk(o, n, g) { let s = 0; for (let i = 0; i < n; i += o.step) { s += i * o.k; if (i === 4) g(o, 2); } return s; }
function nothing(o, depth) { return depth > 0 ? nothing(o, -depth) : 0; }
function widen(o, depth) { if (depth > 0) return widen(o, -depth); o.step = 3; return 0; }
outside.nothing = nothing; outside.widen = widen; outside.walk = walk;
let t = 0; for (let k = 0; k < 300; k++) t += walk({ step: 1, k: 1 }, 10, outside.nothing); console.log(t, walk({ step: 1, k: 1 }, 20, outside.widen));
// STATISTIC: LoopReloadBlocksEmitted >= 1
// STATISTIC: ReloadingBackEdgesEmitted >= 1
