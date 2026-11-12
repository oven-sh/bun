// Sums, products, quotients, remainders and relations of BigInts of every length up to 40 digits and of either sign, under moduli that repeat and that alternate.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=40
let seed = 20261110;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 0; }
function digest(text, hash) { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
function randomBigInt(digits) {
  let text = "0x0";
  for (let i = 0; i < digits * 2; i++) {
    const kind = next() % 8;
    text += (kind === 0 ? 0 : kind === 1 ? 0xffffffff : next()).toString(16).padStart(8, "0");
  }
  return BigInt(text);
}
const edges = [0n, 1n, 2n, 3n, (1n << 63n) - 1n, 1n << 63n, (1n << 64n) - 1n, 1n << 64n, (1n << 64n) + 1n, (1n << 127n), (1n << 128n) - 1n, 1n << 128n, (1n << 192n) - 1n,
  (1n << 255n) - 19n, (1n << 256n) - 1n, 1n << 256n, (1n << 256n) - 2n ** 32n - 977n, 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n, (1n << 320n) - 1n, (1n << 512n) - 1n, 1n << 1024n, (1n << 2048n) - 1n, 1n << 2048n];
const values = [];
for (const edge of edges) values.push(edge, -edge);
for (let i = 0; i < 60; i++) { const value = randomBigInt(i < 40 ? i % 10 : i - 20); values.push(value, -value); }

const operations = {
  add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b, mod: (a, b) => a % b,
  less: (a, b) => a < b, lessOrEqual: (a, b) => a <= b, greater: (a, b) => a > b, greaterOrEqual: (a, b) => a >= b,
  strictlyEqual: (a, b) => a === b, notEqual: (a, b) => a !== b, looselyEqual: (a, b) => a == b,
  branchOnLess: (a, b) => { if (a < b) return 1; return 2; }, branchOnGreaterOrEqual: (a, b) => { if (a >= b) return 1; return 2; }, branchOnEqual: (a, b) => { if (a === b) return 1; return 2; },
};
for (const name in operations) {
  const operation = operations[name];
  let hash = 7;
  for (const a of values) for (const b of values) {
    let text;
    try { const result = operation(a, b); text = typeof result === "bigint" ? result.toString(16) : String(result); } catch (error) { text = error.name + error.message; }
    hash = digest(text, hash);
  }
  console.log(name, hash);
}

// Copies with the same value are other cells.
const copies = values.map(value => BigInt(value.toString()));
let equal = 0, notLess = 0;
for (let i = 0; i < values.length; i++) { if (values[i] === copies[i]) equal++; if (!(values[i] < copies[i]) && values[i] >= copies[i] && values[i] <= copies[i] && !(values[i] > copies[i])) notLess++; }
console.log(equal, notLess, values.length);

// One modulus for many remainders, then another, then both by turns.
function mod(a, b) { const result = a % b; return result >= 0n ? result : b + result; }
for (const modulus of [(1n << 255n) - 19n, (1n << 256n) - 2n ** 32n - 977n, 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n, 2n ** 521n - 1n, 2n ** 384n - 2n ** 128n - 2n ** 96n + 2n ** 32n - 1n, 2n ** 130n - 5n, 1000000007n, 2n ** 1024n - 105n]) {
  let a = mod(randomBigInt(20), modulus), b = mod(randomBigInt(20), modulus), hash = 11;
  for (let i = 0; i < 260; i++) {
    const sum = mod(a + b, modulus), difference = mod(a - b, modulus), product = mod(a * b, modulus), square = mod(a * a, modulus);
    hash = digest(sum.toString(16) + difference.toString(16) + product.toString(16) + square.toString(16) + mod(modulus, modulus) + mod(modulus - 1n, modulus).toString(16) + mod(-modulus, modulus) + mod(modulus * modulus - 1n, modulus).toString(16) + (modulus * 2n % modulus), hash);
    a = product + (i % 3 ? 1n : 0n); b = i % 5 ? square : difference;
  }
  console.log(modulus.toString(16).length, hash);
}
{
  const p = (1n << 255n) - 19n, q = 2n ** 256n - 2n ** 32n - 977n;
  let a = randomBigInt(4), hash = 13;
  for (let i = 0; i < 400; i++) { const m = i % 130 < 110 ? p : i % 2 ? p : q; a = mod(a * a + BigInt(i), m); hash = digest(a.toString(16), hash); }
  console.log("alternating", hash);
}

// Greatest common divisors: divisors that change at every step.
function gcd(a, b) { let x = 0n, y = 1n, u = 1n, v = 0n; while (a !== 0n) { const q = b / a, r = b % a, m = x - u * q, n = y - v * q; b = a; a = r; x = u; y = v; u = m; v = n; } return [b, x, y]; }
let hash = 17;
for (let i = 0; i < 80; i++) { const [g, x, y] = gcd(randomBigInt(1 + i % 8), randomBigInt(1 + i % 5)); hash = digest(g.toString(16) + x.toString(16) + y.toString(16), hash); }
console.log("gcd", hash);

// What is no pair of BigInts.
for (const [a, b] of [[1n, 1], [1, 1n], [1n, "1"], ["1", 1n], [1n, undefined], [null, 1n], [1n, true], [1n, {}], [{ valueOf() { return 3n; } }, 4n], [4n, { valueOf() { return 3n; } }], [4n, Symbol.iterator], [1n, 0.5], [2n, NaN]]) {
  const row = [];
  for (const name in operations) { try { const result = operations[name](a, b); row.push(typeof result === "bigint" ? result + "n" : String(result)); } catch (error) { row.push(error.constructor.name); } }
  console.log(row.join(" "));
}
