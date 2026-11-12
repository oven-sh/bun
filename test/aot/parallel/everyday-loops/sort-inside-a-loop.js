// Lists sorted inside a loop while others are pushed to
function medians(numbers, size) {
  const window = [];
  const out = [];
  for (let i = 0; i < numbers.length; i++) {
    window.push(numbers[i]);
    if (window.length > size) window.shift();
    const sorted = window.slice().sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    out.push(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
    for (let k = 0; k < sorted.length; k++) if (sorted[k] === numbers[i] && out.length < 4) out.push("@" + k);
  }
  return out.join();
}
console.log(medians([5, 1, 4, 2, 8], 3));
console.log(medians([0.5, 2, 0.5, 1], 2));
console.log(medians([], 1), medians([3, 3, 3], 5));
