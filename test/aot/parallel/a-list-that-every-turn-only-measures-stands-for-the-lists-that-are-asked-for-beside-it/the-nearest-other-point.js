// STATISTIC: ArraysGuardedBesideArrays >= 1
const rounds = Number(process.argv[2] ?? 3);
const easts = JSON.parse("[0.25, 137.25, 24.25, 161.25, 48.25, 185.25]");
const norths = JSON.parse("[0.5, 53.5, 106.5, 159.5, 212.5, 15.5]");
function spread(start) {
  let total = start & 3;
  for (let here = 0; here < easts.length; here++) {
    let least = Infinity;
    for (let there = 0; there < easts.length; there++) {
      if (here === there) continue;
      const east = easts[here] - easts[there];
      const north = norths[here] - norths[there];
      const far = Math.sqrt(east * east + north * north);
      if (far < least) least = far;
    }
    total += least;
  }
  return total;
}
const byName = { spread };
const name = JSON.parse('"spread"');
let all = 0;
for (let round = 0; round < rounds; round++) all = (all * 31 + byName[name](round)) % 1000003;
console.log(all.toFixed(6));
