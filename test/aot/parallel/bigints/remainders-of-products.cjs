// The remainder of a product: at once, behind a default parameter that is read off a frozen or a replaced object, under moduli of several lengths, with operands that are no BigInts.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=40
let seed = 77;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 0; }
function digest(text, hash) { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
function randomBigInt(digits) { let text = "0x0"; for (let i = 0; i < digits * 2; i++) { const kind = next() % 8; text += (kind === 0 ? 0 : kind === 1 ? 0xffffffff : next()).toString(16).padStart(8, "0"); } return BigInt(text); }
let CLOCK = Object.freeze({ turns: (1n << 255n) - 19n, first: 4n });
function hourOf(sum, turns = CLOCK.turns) { let left = sum % turns; if (left < 0n) left += turns; return left; }
function line(x, y) { return hourOf(x * y); }
function square(x) { return hourOf(x * x); }
function under(x, y, m) { return (x * y) % m; }
function chain(x, y, z) { const a = hourOf(x * y), b = hourOf((x + y) * (z - y)), c = hourOf(a * b); return hourOf(c * hourOf(z * z)); }
function kept(x, y) { const product = x * y; const rest = product % CLOCK.turns; return product - rest; }
function branched(x, y, flag) { const product = x * y; if (flag) return product; return product % CLOCK.turns >= 0n; }
function raised(x, n, turns) { if (n === 0n) return 1n; const half = raised(x, n / 2n, turns), whole = hourOf(half * half, turns); return n % 2n ? hourOf(whole * x, turns) : whole; }

const moduli = [(1n << 255n) - 19n, (1n << 256n) - 2n ** 32n - 977n, 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n, (1n << 256n) - 189n, 2n ** 192n - 237n, 2n ** 521n - 1n, 1000003n, 7n];
let hash = 1;
for (const m of moduli) {
  CLOCK = moduli.indexOf(m) % 3 === 2 ? { a: 1n, b: 2n, turns: m } : Object.freeze({ turns: m, a: -1n });
  let x = randomBigInt(4) % m, y = randomBigInt(4) % m, z = randomBigInt(4);
  for (let i = 0; i < 300; i++) {
    x = line(x, y); y = square(y) + BigInt(i % 3); z = chain(x, y, z); if (i % 50 === 49) { x = -x; z = m - 1n; }
    hash = digest(x.toString(16) + y.toString(16) + z.toString(16) + under(z, -x, m).toString(16) + kept(x, z).toString(16) + String(branched(x, y, i & 1)), hash);
  }
  console.log(m.toString(16).length, hash, raised(3n, m - 1n, m), raised(z, m - 2n, m) === 0n);
}
CLOCK = { get turns() { hash++; return (1n << 255n) - 19n; } };
console.log(line(3n, 1n << 254n), square(1n << 200n), hash !== 1);
CLOCK = Object.freeze({ turns: (1n << 255n) - 19n });
for (let i = 0; i < 200; i++) hash = digest(square(randomBigInt(4)).toString(16), hash);
console.log(hash);

for (const [x, y] of [[1n, 2], [2, 3n], ["4", 5n], [6n, undefined], [7, 8], [1.5, 2], ["a", 2], [{ valueOf() { return 9n; } }, 10n], [null, true], [2n ** 300n, 3], [Symbol.iterator, 1n]]) {
  const row = [];
  for (const f of [line, square, (a, b) => under(a, b, (1n << 255n) - 19n), (a, b) => under(a, b, 7), kept, (a, b) => branched(a, b, false)]) {
    try { const result = f(x, y); row.push(typeof result === "bigint" ? result + "n" : String(result)); } catch (error) { row.push(error.name + (/\bat hourOf\b/.test(error.stack) ? " in hourOf" : "")); }
  }
  console.log(row.join(" | "));
}
for (const zero of [0n, -0n]) { try { console.log(under(5n, 6n, zero)); } catch (error) { console.log(error.name, error.message); } }
try { under(1n << 1000000000n, 1n << 1000000000n, 7n); } catch (error) { console.log(error.name); }
