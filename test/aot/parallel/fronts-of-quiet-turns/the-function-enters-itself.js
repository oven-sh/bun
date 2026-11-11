function fold(o, depth) { let s = 0; for (let i = 0; i < o.n; i++) { s += o.v; if (i === 1 && depth) { o.v++; s += fold(o, depth - 1); } } return s; }
function set(o, n) { o.n = n; return o; }
let t = 0; for (let k = 0; k < 200; k++) t += fold(set({ n: 4, v: 1 }, 4), 2); console.log(t);
// STATISTIC: LoopReloadBlocksEmitted >= 1
// STATISTIC: ReloadingBackEdgesEmitted >= 1
