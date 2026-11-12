// Steps, negations, bitwise operators and shifts of BigInts of every length up to 40 digits and of either sign, and products of every pair of lengths up to 18 digits.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=40
let seed = 2110;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 0; }
function digest(text, hash) { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
function randomBigInt(digits) {
  let text = "0x0";
  for (let i = 0; i < digits * 2; i++) { const kind = next() % 8; text += (kind === 0 ? 0 : kind === 1 ? 0xffffffff : next()).toString(16).padStart(8, "0"); }
  return BigInt(text);
}
const values = [];
for (const edge of [0n, 1n, 2n, (1n << 63n) - 1n, 1n << 63n, (1n << 64n) - 1n, 1n << 64n, (1n << 64n) + 1n, (1n << 128n) - 1n, 1n << 128n, (1n << 192n), (1n << 255n) - 19n, (1n << 256n) - 1n, 1n << 256n, (1n << 2048n) - 1n, 1n << 2048n]) values.push(edge, -edge);
for (let i = 0; i < 48; i++) { const value = randomBigInt(i % 41); values.push(value, -value); }

const unary = { negate: a => -a, not: a => ~a, increment: a => { a++; return a; }, decrement: a => { a--; return a; }, before: a => a++, behind: a => --a, truth: a => a ? 1n : 0n, again: a => -(-a) };
for (const name in unary) { let hash = 3; for (const a of values) hash = digest(unary[name](a).toString(16), hash); console.log(name, hash); }

const binary = { and: (a, b) => a & b, or: (a, b) => a | b, xor: (a, b) => a ^ b };
for (const name in binary) { let hash = 5; for (const a of values) for (const b of values) hash = digest(binary[name](a, b).toString(16), hash); console.log(name, hash); }

const amounts = [0n, 1n, 2n, 31n, 32n, 63n, 64n, 65n, 127n, 128n, 129n, 192n, 255n, 256n, 257n, 1000n, 2047n, 2048n, 2049n, 5000n, 1n << 64n, 1n << 70n, -1n, -2n, -63n, -64n, -65n, -300n];
for (const [name, shift] of Object.entries({ right: (a, b) => a >> b, left: (a, b) => a << b })) {
  let hash = 9;
  for (const a of values) for (const b of amounts) { let text; try { text = shift(a, b).toString(16); } catch (error) { text = error.name; } hash = digest(text, hash); }
  console.log(name, hash);
}

let hash = 21;
for (let i = 0; i <= 18; i++) for (let j = 0; j <= 18; j++) {
  const a = randomBigInt(i), b = randomBigInt(j);
  hash = digest((a * b).toString(16) + (-a * b).toString(16) + (a * a).toString(16) + (a * -a).toString(16), hash);
  if (b) { const q = a / b, r = a % b; if (q * b + r !== a) console.log("no quotient", i, j); hash = digest(q.toString(16) + r.toString(16), hash); }
}
console.log("products", hash);

// Moduli of four digits next to a power of two, with remainders at their borders.
for (const c of [1n, 2n, 5n, 19n, 189n, 977n, (1n << 32n) + 977n, (1n << 63n) - 1n, (1n << 64n) - 1n]) for (const bits of [256n, 255n, 254n]) {
  const m = (1n << bits) - c;
  let a = randomBigInt(4) % m, hash = 23;
  for (let i = 0; i < 130; i++) a = (a * a + 1n) % m;
  const borders = [0n, 1n, m - 1n, m, m + 1n, 2n * m - 1n, 2n * m, 2n * m + 1n, 3n * m, 4n * m - 1n, 4n * m, 4n * m + 5n, (1n << 256n) - 1n, 1n << 256n, (1n << 256n) + 1n, m * m - 1n, m * m, (m - 1n) * (m - 1n), m * m + m, (1n << 512n) - 1n, 1n << 511n, (1n << 448n) - 1n, (1n << 384n) - 1n, (1n << 320n) - 1n, ((1n << 256n) - 1n) << 256n, ((1n << 64n) - 1n) << 256n];
  for (const border of borders) for (const value of [border, -border]) { const r = value % m; if ((value - r) % m !== 0n) console.log("no remainder", bits, c, value); hash = digest(r.toString(16), hash); }
  console.log(bits + "-" + c, hash, a.toString(16).length);
}

function countdown(value) { let steps = 0; while (value-- > 0n) steps++; return steps; }
console.log(countdown(1000n), countdown(0n), countdown(-5n));
let up = (1n << 64n) - 3n; for (let i = 0; i < 6; i++) { up++; console.log(up); }
for (let i = 0; i < 6; i++) { up--; console.log(up); }
let through = 2n; for (let i = 0; i < 5; i++) { through--; console.log(through); }
for (const value of [undefined, null, true, "7", 1.5, {}, Symbol.iterator]) { const row = []; for (const name in unary) { try { row.push(String(unary[name](value))); } catch (error) { row.push(error.constructor.name); } } console.log(row.join(" ")); }
