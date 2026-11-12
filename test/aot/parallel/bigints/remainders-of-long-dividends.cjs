// Remainders by divisors near powers of two: dividends of 0 to 36 digits, divisors in turns, products that are left to remainders, remainders made positive.
const near = (bits, difference) => (1n << bits) - difference;
const divisors = [near(255n, 19n), near(256n, (1n << 32n) + 977n), near(254n, 1n), near(253n, 5n), near(256n, (1n << 56n)), near(256n, (1n << 56n) + 1n), near(256n, (1n << 64n)), near(256n, (1n << 64n) - 1n), near(255n, 1n << 61n), (1n << 255n) + 3n, near(192n, 11n), near(320n, 197n), near(256n, 1n) ^ (1n << 130n)];
const lines = [];
let hash = 0;
function seen(value) {
  const text = value.toString(16);
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
}
function mod(a, m) {
  const r = a % m;
  return r >= 0n ? r : m + r;
}
function pow(x, n, m) {
  let r = x;
  while (n-- > 0n) {
    r *= r;
    r %= m;
  }
  return r;
}
function dividends(m) {
  const list = [0n, 1n, m - 1n, m, m + 1n, 2n * m, m * m, m * m - 1n, m * m * m + 7n, (1n << 256n) - 1n, 1n << 256n, (1n << 512n) - 1n, 1n << 512n, (1n << 768n) - 1n, 1n << 1023n, (1n << 2047n) - 1n, (1n << 2048n) + 5n, 1n << 2300n];
  let x = 0x1234567890abcdef1234567890abcdefn;
  for (let bits = 10n; bits < 2400n; bits += 61n) {
    x = (x * 0x9e3779b97f4a7c15f39cc0605cedc835n + bits) & ((1n << 2400n) - 1n);
    list.push((x * x * x) & ((1n << bits) - 1n));
  }
  return list;
}
function all(m, other) {
  let sum = 0n;
  for (const a of dividends(m)) {
    for (const sign of [1n, -1n]) {
      const b = sign * a;
      seen(b % m);
      seen((b * a) % m);
      seen(mod(b * other, m));
      seen((b * a * other) % m);
      seen(b % other);
      let r = b;
      r *= a;
      r %= m;
      seen(r);
      seen(pow(b % m, 5n, m));
      sum = mod(sum + b * 3n, m);
    }
  }
  return sum;
}
for (let i = 0; i < divisors.length; i++) {
  hash = 0;
  for (let round = 0; round < 3; round++) seen(all(divisors[i], divisors[(i + round + 1) % divisors.length]));
  lines.push(hash);
}
console.log(lines.join("\n"));
