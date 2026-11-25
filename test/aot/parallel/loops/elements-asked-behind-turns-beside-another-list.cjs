// Elements that the turns of an unrolled loop add up are asked for holes behind all turns: where a later turn leaves in the middle at a hole of another read, the turns run again.
function f(v, w, n, k) { let total = 0, before = 0, turns = 0; for (let i = 0; i < v.length; i++) { total += v[i]; before += w[i - 1]; turns++; } return total + " " + before + " " + turns; }
for (const at of [0, 1, 3, 4, 5, 8, 11]) for (const bt of [2, 5, 9]) for (const k of [1, 2]) {
  const v = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28], w = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  delete v[at]; delete w[bt];
  console.log(at, bt, f(v, w, 13, k), f(w, v, 14, k), f([1, 2, 3, 4, 5, 6, 7, 8, 9], w, 8, k));
}
