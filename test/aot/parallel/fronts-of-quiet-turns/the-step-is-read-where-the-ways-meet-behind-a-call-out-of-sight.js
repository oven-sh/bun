function walk(o, n, g) { let s = 0; for (let i = 0; i < n; i += o.step) { s += i * o.k; if (i === 4) g(o, 2); } return s; }
function nothing(o, depth) { return depth > 0 ? nothing(o, depth - 1) : 0; }
function widen(o, depth) { if (depth > 0) return widen(o, depth - 1); o.step = 3; return 0; }
let t = 0; for (let k = 0; k < 300; k++) t += walk({ step: 1, k: 1 }, 10, nothing); console.log(t, walk({ step: 1, k: 1 }, 20, widen));
// STATISTIC: FrontsOfQuietTurnsThatHoldReads >= 1
// STATISTIC: LoudTurnsLedThroughFronts >= 1
