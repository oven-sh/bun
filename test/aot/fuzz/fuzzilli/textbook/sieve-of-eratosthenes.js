function primesBelow(end) {
  const crossed = new Array(end).fill(false);
  const primes = [];
  for (let i = 2; i < end; i++) {
    if (crossed[i]) continue;
    primes.push(i);
    for (let j = i * i; j < end; j += i) {
      crossed[j] = true;
    }
  }
  return primes;
}
console.log(primesBelow(Number("50")).join());
