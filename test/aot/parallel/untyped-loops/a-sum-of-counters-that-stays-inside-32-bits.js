// A sum over at most a thousand turns of a small number fits 32 bits. Whatever the number of turns, and whoever looks at the sum in the middle of the loop, sees what each turn left.
function plain(n) {
  let total = n & 1;
  for (let k = 0; k < (n & 1023); k++) total += k;
  return total;
}
function seenAt(n, at) {
  let total = 0;
  let seen = -1;
  for (let k = 0; k < (n & 1023); k++) {
    total += k & 7;
    if (k === at) seen = total;
  }
  return total * 1000 + seen;
}
function largestSoFar(n) {
  let total = 0;
  let best = -1;
  let where = -1;
  for (let k = 0; k < (n & 255); k++) {
    total += (k * 5) & 15;
    if (((k * 5) & 15) > best) {
      best = (k * 5) & 15;
      where = total;
    }
  }
  return best * 100000 + where;
}
function storedEveryTurn(n) {
  const sums = [];
  let total = 0;
  for (let k = 0; k < (n & 31); k++) {
    total += k;
    sums[k] = total;
  }
  return sums.join();
}
function leftEarly(n, limit) {
  let total = 0;
  for (let k = 0; k < (n & 1023); k++) {
    total += k;
    if (total > limit) break;
  }
  return total;
}
function downwards(n) {
  let total = 0;
  for (let k = n & 1023; k > 0; k -= 3) total -= k;
  return total;
}
function* count(to) {
  for (let k = 0; k < to; k++) yield k;
}
function ofGenerator(n) {
  let total = n & 1;
  for (const value of count(n & 127)) total += value;
  return total;
}
for (const n of [0, 1, 2, 7, 8, 9, 15, 16, 17, 23, 24, 25, 63, 64, 65, 100, 255, 1000, 1023, 1024, 1031])
  console.log(n, plain(n), seenAt(n, 0), seenAt(n, 7), seenAt(n, 8), seenAt(n, 12), seenAt(n, n - 1), largestSoFar(n), storedEveryTurn(n), leftEarly(n, 40), leftEarly(n, 1e9), downwards(n), ofGenerator(n));
