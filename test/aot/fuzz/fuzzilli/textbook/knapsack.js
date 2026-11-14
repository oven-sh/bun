function most(weights, worths, room) {
  const best = new Array(room + 1).fill(0);
  for (let i = 0; i < weights.length; i++) {
    for (let left = room; left >= weights[i]; left--) {
      const taken = best[left - weights[i]] + worths[i];
      if (taken > best[left]) best[left] = taken;
    }
  }
  return best[room];
}
console.log(most(JSON.parse("[1,3,4,5]"), JSON.parse("[1,4,5,7]"), 7));
