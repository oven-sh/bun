// Elements that the turns of an unrolled loop add up are asked for holes behind all turns: where a later turn leaves in the middle at a hole of another read, the turns run again.
function sums(v) {
  let total = 0, before = 0;
  for (let i = 0; i < v.length; i++) { total += v[i]; before += v[i - 1]; }
  return total + " " + before;
}
const v = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
delete v[4];
console.log(sums(v));
