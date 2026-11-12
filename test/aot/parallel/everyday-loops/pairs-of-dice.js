// Sums of two dice counted in a list, shares pushed behind them
function shares(sides, scale) {
  const counts = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      const sum = (sides[a - 1] + sides[b - 1]) | 0;
      counts[sum] = (counts[sum] || 0) + 1;
    }
  }
  const out = [];
  for (let sum = 0; sum < counts.length; sum++) if (counts[sum]) out.push(sum, (counts[sum] * scale) / 36);
  return out.join() + " " + counts.length;
}
console.log(shares([1, 2, 3, 4, 5, 6], 36));
console.log(shares([1, 1, 2, 2, 3, 3], 1));
console.log(shares([0, 0, 0, 0, 0, 10], 72));
