// The same with while loops and counters of their own
function lap(values) {
  const out = [];
  let i = 0;
  while (i < 4) {
    let k = 0;
    while (k < 2) {
      out.push(values[k]);
      k++;
    }
    out.push(values[i]);
    i++;
  }
  return out.reduce((sum, value) => sum + value, 0) + " " + out.length;
}
console.log(lap([1, 2, 3, 4]));
console.log(lap([25, 50, 75, 100]));
console.log(lap([2147483647, 1, 1, 1]));
