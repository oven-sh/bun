// Functions that count in captured variables, called in loops within loops of generators and async functions that run in a loop: the build of each ends.
(function () {
let count = 0, trace = ''; function tell(q) { count += q; trace += q; return q; }
function* g0() { let z1 = 0; while (z1++ < 4) { for (let z = 0; z < 3; z++) { tell(1); } } tell(1); return 1; }
const f0 = o => g0().next().value;
for (const a of [1, 2]) { const r = f0(); console.log(r, trace, count); }
})();
(async function () {
let count = 0; const tell = q => { count += q; };
async function g0() { let z1 = 0; while (z1++ < 4) { for (let z = 0; z < 3; z++) tell(1); } tell(1); return 1; }
for (const a of [1, 2]) console.log(await g0(), count);
})();
(function () {
let n = 0, m = 0; const up = () => { n++; }, down = () => { m--; return m; };
function each(k) { let t = 0; while (k-- > 0) { for (let i = 0; i < 3; i++) { up(); for (let j = 0; j < 2; j++) t += down(); } } return t; }
for (const k of [2, 5]) console.log(each(k), n, m);
})();
