// A sieve in a plain list and one in a typed array, primes pushed by both
function primes(limit) {
  const plain = [];
  const typed = new Uint8Array(limit + 1);
  const found = [];
  const again = [];
  for (let i = 2; i <= limit; i++) {
    if (!plain[i]) {
      found.push(i);
      for (let k = i + i; k <= limit; k += i) plain[k] = true;
    }
    if (typed[i] === 0) {
      again.push(i);
      for (let k = i * i; k <= limit; k += i) typed[k] = 1;
    }
  }
  return found.join() + " " + (found.join() === again.join()) + " " + plain.length;
}
console.log(primes(30));
console.log(primes(97));
console.log(primes(1), primes(2));
