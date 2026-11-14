// The remainder of a product of BigInts of one digit: signs, zeros, products of one and of two digits, lengths that differ, divisors that are zero.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=40
let seed = 5;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 0; }
function digest(text, hash) { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
function under(x, y, m) { return (x * y) % m; }
function squareUnder(x, m) { return (x * x) % m; }
function power(value, exponent, m) { let result = 1n, base = value % m; for (let e = exponent; e > 0n; e >>= 1n) { if (e & 1n) result = (result * base) % m; base = (base * base) % m; } return result; }
function slow(x, y, m) { const text = String(BigInt(x) * BigInt(y)); return BigInt(text) % BigInt(m); }

const max = 0xffffffffffffffffn;
const edges = [0n, 1n, 2n, 3n, 10n, 255n, 1n << 31n, 1n << 32n, (1n << 32n) - 1n, (1n << 53n) - 1n, 1n << 53n, 1n << 63n, (1n << 63n) - 1n, max - 1n, max, max + 1n, 1n << 127n, 1n << 128n, 1n << 256n];
let hash = 7, wrong = 0, count = 0;
for (const x of edges) {
  for (const y of edges) {
    for (const m of edges) {
      if (m === 0n) continue;
      for (const [a, b, d] of [[x, y, m], [-x, y, m], [x, -y, -m], [-x, -y, m]]) {
        const rest = under(a, b, d);
        if (rest !== slow(a, b, d)) wrong++;
        if (rest === 0n && 1 / Number(rest) !== Infinity) wrong++;
        count++;
        hash = digest(rest.toString(36), hash);
      }
      hash = digest(squareUnder(x, m).toString(36) + squareUnder(-y, -m).toString(36), hash);
    }
  }
}
console.log(count, wrong, hash);
for (let i = 0; i < 3000; i++) {
  const shift = BigInt(next() % 63), x = (BigInt(next()) << 32n | BigInt(next())) >> shift, y = BigInt(next()) << BigInt(next() % 33), m = (BigInt(next()) << 32n | BigInt(next())) >> BigInt(next() % 60) | 1n;
  if (under(x, -y, m) !== -under(x, y, m) || under(x, y, m) !== slow(x, y, m)) wrong++;
  hash = digest(under(x, y, m).toString(16) + squareUnder(y, m).toString(16), hash);
}
console.log(wrong, hash, power(3n, 1000002n, 1000003n), power(5n, max, (1n << 61n) - 1n), power(7n, 123456789n, max - 58n), power(2n, 64n, max));
for (const [x, y, m] of [[6n, 7n, 0n], [0n, 7n, 0n], [6n, 7, 5n], [6, 7n, 5n], [6n, 7n, 5], [6, 7, 5], ["6", 7n, 5n], [undefined, 7n, 5n], [6n, null, 5n], [6n, Symbol.iterator, 0n], [6n, { valueOf() { return 7n; } }, 5n], [6n, 7n, { valueOf() { throw new RangeError("divisor"); } }], [true, 1n, 1n]]) {
  try { const rest = under(x, y, m); console.log(typeof rest, String(rest)); } catch (error) { console.log(error.name, error.message); }
}
