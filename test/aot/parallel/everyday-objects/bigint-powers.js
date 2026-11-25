// Powers, factorials and roots of BigInt values in loops
function powers(base, n) {
  const out = [];
  let factorial = 1n;
  for (let i = 1n; i <= n; i++) {
    factorial *= i;
    out.push(base ** i, (base ** i) % 7n);
  }
  let root = factorial;
  for (let next = (root + 1n) / 2n; next < root; next = (root + factorial / root) / 2n) root = next;
  return out.join() + " " + factorial + " " + root;
}
console.log(powers(2n, 4n));
console.log(powers(-3n, 3n));
console.log(powers(10n, 20n).length, powers(1n, 1n));
