// Two for-of loops walk one array that the function is handed, its first element is read by index between them, and the first loop holds a loop of its own that may not run. Built with every pass verified.
function leastShared(key, numbers, into) {
  const divisor = (a, b) => (!b ? a : divisor(b, a % b));
  const shared = (a, b) => (a * b) / divisor(a, b);
  let scale = 1;
  for (const number of numbers) {
    while (number * scale % 1 !== 0) {
      scale *= 10;
    }
  }
  let result = numbers[0] * scale;
  for (const number of numbers) {
    result = shared(result, number * scale);
  }
  into[key] = result / scale;
}
const out = {};
leastShared("halves", [0.5, 2, 3], out);
leastShared("whole", [4, 6], out);
leastShared("one", [7], out);
console.log(out.halves, out.whole, out.one);
