// STATISTIC: ComparedArraysGuardedForStores >= 1
// if (p[0] < least[0]) least[0] = p[0]; if (p[1] < least[1]) ..: both arrays are asked before the first comparison, and the iteration restarts where one is of another kind.
const points = [];
for (let k = 0; k < 64; k++) points.push([k + 0.5, k * 0.25, 3.5]);
function grow(o, p) {
  if (p[0] < o[0]) o[0] = p[0];
  if (p[1] < o[1]) o[1] = p[1];
  if (p[2] > o[2]) o[2] = p[2];
  return o;
}
const box = [1.5, 1.5, 1.5];
function work(i) {
  return grow(box, points[i])[2];
}
function run(n) {
  let s = 0;
  for (let r = 0; r < n; r++) for (let i = 0; i < 64; i++) s = s * 0.5 + work(i);
  return s;
}
console.log(run(3));
for (let turn = 0; turn < 40; turn++) {
  const p = points[(turn * 7) % 64];
  p[turn % 3] = (turn % 5) * 2.5 - turn;
  if (turn % 11 === 3) p[1] = NaN;
  if (turn % 13 === 5) p[2] = turn;
  console.log(turn, run(2));
}
