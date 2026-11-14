// Remainders by 256-bit divisors that are a little less than a power of two (or than a third of one), of products, sums and differences around their multiples.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=400
let seed = 99;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 0; }
function randomBigInt(words) { let value = 0n; for (let i = 0; i < words; i++) { const kind = next() % 6; value = (value << 32n) | BigInt(kind === 0 ? 0 : kind === 1 ? 0xffffffff : next()); } return value; }
function digest(text, hash) { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
function productUnder(x, y, m) { return (x * y) % m; }
function squareUnder(x, m) { return (x * x) % m; }
function under(x, m) { return x % m; }
function mod(a, m) { const result = a % m; return result >= 0n ? result : m + result; }
function rest(x, m) { return x - (x / m) * m; }

const one = 1n;
const top = one << 256n, all = top - one;
const divisors = [];
for (const c of [1n, 19n, 189n, 977n, (one << 32n) + 977n, (one << 58n) + 1n, (one << 60n) - 1n, (one << 60n) + 5n, (one << 61n) + 3n, (one << 62n) + 1n, (one << 63n) + 9n, (one << 64n) - 1n, one << 64n, (one << 64n) + 1n])
  for (const bits of [256n, 255n, 254n, 253n]) divisors.push((one << bits) - c);
for (const c of [1n, 4n, 1000n, (one << 40n) + 3n, (one << 61n) + 1n]) { let t = top - c; while (t % 3n) t -= one; divisors.push(t / 3n); }
divisors.push((one << 192n) - 237n, (one << 128n) - 159n, (one << 320n) - 197n, (one << 521n) - 1n, one << 255n, (one << 255n) + 95n);
let hash = 3, wrong = 0;
for (const m of divisors) {
  let x = randomBigInt(8) % m;
  for (let i = 0; i < 130; i++) x = squareUnder(x, m) + one;
  const terms = [0n, 1n, 2n, m - one, m, m + one, 2n * m - one, 2n * m, 2n * m + one, 3n * m, 4n * m - one, 4n * m, all, all - one, all - m, top, top - m, m >> 1n, (m >> 1n) + one, m ^ (m >> 1n)];
  for (let i = 0; i < 8; i++) terms.push(randomBigInt(8), randomBigInt(1 + next() % 8));
  for (const a of terms) {
    for (const b of terms) {
      const p = productUnder(a, b, m), n = productUnder(-a, b, m), s = under(a + b, m), d = mod(a - b, m), q = squareUnder(b, m);
      if (p !== rest(a * b, m) || n !== -p || s !== rest(a + b, m) || q !== rest(b * b, m) || rest(d - (a - b), m) !== 0n || d < 0n || d >= m) wrong++;
      hash = (Math.imul(hash, 31) + Number(BigInt.asIntN(32, p ^ s)) + Number(BigInt.asIntN(32, d >> 224n)) + Number(BigInt.asIntN(32, (p >> 190n) ^ n))) | 0;
    }
    hash = digest(under(-a * (all - a), m).toString(36), hash);
  }
  console.log(m.toString(16).length, wrong, hash);
}
