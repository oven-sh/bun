// BigInt elements pushed by the inner loop, sums behind it
function grow(list) {
  const out = [];
  let sum = 0n;
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      out.push(list[k] * 3n);
      sum += list[k];
    }
    out.push(sum << BigInt(i));
  }
  return out.join();
}
console.log(grow([1n, 2n, 3n]));
console.log(grow([-1n, 2n ** 64n]));
console.log(grow([0n, 0n]), grow([5n, -5n]));
