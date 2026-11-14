// BigInt sums in two loops with written bounds, pushed at both levels
function sums(start) {
  const out = [];
  let sum = start;
  for (let i = 0; i < 3; i++) {
    for (let k = 1; k < 4; k++) {
      sum = sum * 2n + BigInt(k * i);
      if (sum % 3n === 0n) out.push(sum);
    }
    out.push(-sum);
  }
  return out.join();
}
console.log(sums(1n));
console.log(sums(-5n));
console.log(sums(2n ** 63n), sums(0n));
