// A value of a formula that only operators read is kept by a callee that is called in a rare branch alone: an object of another class, a replaced record, a handler.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=30
let seed = 9;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 0; }
function digest(text, hash) { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
function random(words) { let value = 0n; for (let i = 0; i < words; i++) value = (value << 32n) | BigInt(next()); return next() & 1 ? value : -value; }
const kept = [];
class Reader {
  constructor(limit) { this.limit = limit; }
  isLess(value) { return value < this.limit; }
  sign(value) { return value >= 0n ? 1n : -1n; }
}
// No text names these methods of other objects.
function named(...parts) { return parts.join(""); }
const keeper = {}, literal = {};
keeper[named("is", "Less")] = value => { kept.push(value); return value < 5n; };
keeper[named("si", "gn")] = value => { kept.push(() => value); return 1n; };
literal[named("is", "Less")] = value => { kept.push(value, [value]); return false; };
literal[named("si", "gn")] = value => { kept.push({ value }); throw value; };
let CURVE = Object.freeze({ P: (1n << 255n) - 19n });
function mod(a, m = CURVE.P) { const result = a % m; return result >= 0n ? result : m + result; }
function formula(reader, a, b) {
  const s = a * b + a, d = s - b;
  if (reader.isLess(s)) return d * 2n - s;
  const p = mod(d * d), q = p * reader.sign(d) - s;
  return reader.isLess(q) ? q + p : q - d;
}
function around(reader, a, n) {
  let x = a, y = a + 1n, sum = 0n;
  for (let i = 0; i < n; i++) {
    const z = mod(x * y + sum);
    if (reader.isLess(z)) sum = sum + z; else sum = z - sum;
    x = y; y = z;
  }
  return sum - x + reader.sign(y) * y;
}
const readers = [new Reader(0n), new Reader(1n << 250n), new Reader(-(1n << 100n))];
let hash = 7;
for (let i = 0; i < 600; i++) {
  if (i === 200) CURVE = { a: 1n, P: (1n << 256n) - 189n };
  if (i === 400) CURVE = { get P() { kept.push("get"); return 1000003n; } };
  const a = random(next() % 14), b = random(next() % 14), reader = i % 11 === 3 ? keeper : i % 13 === 5 ? literal : readers[i % 3];
  let one, two;
  try { one = formula(reader, a, b); } catch (error) { one = typeof error === "bigint" ? "thrown " + error : error.name; }
  try { two = around(reader, b, i % 8); } catch (error) { two = typeof error === "bigint" ? "thrown " + error : error.name; }
  hash = digest(`${one},${two}`, hash);
  if (i % 50 === 49) console.log(hash, kept.length, digest(kept.map(k => String(typeof k === "function" ? k() : typeof k === "object" && !Array.isArray(k) ? k.value : k)).join(), 3));
}
