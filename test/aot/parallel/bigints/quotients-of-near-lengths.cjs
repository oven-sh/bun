// Quotients and remainders of the same operands: dividends as long as the divisor, one digit longer, shorter; quotients around 2^64; divisors whose high digits are all ones or a power of two; equality and order with zero.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=50
let seed = 23;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 0; }
function digest(text, hash) { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
function random(words) { let value = 0n; for (let i = 0; i < words; i++) { const kind = next() % 5; value = (value << 32n) | BigInt(kind === 0 ? 0 : kind === 1 ? 0xffffffff : kind === 2 ? 0x80000000 : next()); } return value; }
function both(a, b) { const q = b / a, r = b % a; const back = q * a + r; return back === b && (r === 0n || r < 0n === b < 0n) ? q - r : undefined; }
function quotient(a, b) { const q = b / a; return q * 3n - q; }
function remainder(a, b) { const r = b % a; return r + r * 2n; }
function gcd(a, b) { let steps = 0n; while (a !== 0n) { const q = b / a, r = b % a; b = a; a = r; steps += q & 1n; } return b * 1000n + steps; }
function zeros(a, b) { const d = a - b, e = a + b; return [d === 0n, 0n === d, d == 0n, d !== 0n, e > 0n, e >= 0n, e < 0n, e <= 0n, d === e, d == e].map(Number).join(""); }
let hash = 5, wrong = 0;
const edges = [1n, 2n, 3n, (1n << 63n) - 1n, 1n << 63n, (1n << 64n) - 1n, 1n << 64n, (1n << 64n) + 1n, (1n << 127n) + 1n, (1n << 128n) - 1n, 1n << 128n, (1n << 191n) - 1n, (1n << 192n) - 1n, (1n << 255n) - 19n, (1n << 256n) - 1n, 1n << 256n, (1n << 256n) - (1n << 128n), (1n << 320n) - 1n];
const values = [...edges];
for (let i = 0; i < 60; i++) values.push(random(1 + next() % 12) + 1n);
for (const a of values) {
  for (const b of values) {
    for (const dividend of [b, -b, a * b, a * b + a - 1n, a * b - 1n, a * ((1n << 64n) - 1n) + (b % a), a << 64n, (a << 64n) - 1n, a * (b % (1n << 64n)), a >> 1n, 0n]) {
      const one = both(a, dividend), two = both(-a, dividend);
      if (one === undefined || two === undefined) wrong++;
      hash = (Math.imul(hash, 31) + Number(BigInt.asIntN(32, (one ?? 0n) ^ (two ?? 0n) ^ quotient(a, dividend) ^ remainder(-a, dividend)))) | 0;
    }
    hash = digest(zeros(a, b) + zeros(-a, a) + zeros(b - b, 0n), hash);
  }
}
console.log(values.length, wrong, hash);
for (let i = 0; i < 300; i++) hash = digest(String(gcd(random(8) + 1n, random(1 + next() % 10))), hash);
console.log(hash);
for (const [a, b] of [[0n, 5n], [0n, 0n], [3, 5n], [3n, 5], [3, 5], ["3", 5n], [undefined, 5n], [3n, null], [Symbol.iterator, 5n], [{ valueOf() { return 3n; } }, 17n], [3n, { valueOf() { return 17n; } }]]) {
  const row = [];
  for (const f of [both, quotient, remainder, zeros, gcd]) { try { const r = f(a, b); row.push(typeof r + String(r)); } catch (error) { row.push(error.name + error.message); } }
  console.log(row.join(" | "));
}
