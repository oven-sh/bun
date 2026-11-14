// A histogram in a typed array, its sums in a second one
function histogram(values, bins) {
  const counts = new Uint8Array(bins);
  const sums = new Float64Array(bins);
  for (let i = 0; i < values.length; i++) {
    for (let b = 0; b < bins; b++) {
      if (values[i] < b || values[i] >= b + 1) continue;
      counts[b]++;
      sums[b] += values[i];
    }
  }
  return counts.join() + " " + sums.join();
}
console.log(histogram([0, 1, 1, 2.5, 3], 4));
console.log(histogram(new Array(300).fill(0.25), 2));
console.log(histogram(["1", null, NaN, -1, 1e9], 3));
