function remembering(work) {
  const seen = new Map();
  return function (n) {
    if (!seen.has(n)) seen.set(n, work(n));
    return seen.get(n);
  };
}
let calls = 0;
function slowSquare(n) {
  calls++;
  return n * n;
}
const square = remembering(slowSquare);
console.log(square(4), square(4), square(5), calls);
