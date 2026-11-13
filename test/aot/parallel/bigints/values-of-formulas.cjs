// Values of formulas that only operators read, beside values that are kept: by lists, closures, records, throws, calls in rare branches; in branches, loops and calls that call themselves; of 0 to 40 digits; numbers, strings and objects among them.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=30
let seed = 41;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 0; }
function digest(text, hash) { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
function random(words) { let value = 0n; for (let i = 0; i < words; i++) { const kind = next() % 6; value = (value << 32n) | BigInt(kind === 0 ? 0 : kind === 1 ? 0xffffffff : next()); } return next() & 1 ? value : -value; }
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2);
const CURVE = Object.freeze({ P: (1n << 255n) - 19n });
function mod(a, m = CURVE.P) { const result = a % m; return result >= _0n ? result : m + result; }
const shown = [];

// A point of a curve: every product, sum and remainder but the last four is read by operators alone.
class Point {
  constructor(x, y, z, t) { this.x = x; this.y = y; this.z = z; this.t = t; }
  add(other) {
    const { x: X1, y: Y1, z: Z1, t: T1 } = this;
    const { x: X2, y: Y2, z: Z2, t: T2 } = other;
    const A = mod((Y1 - X1) * (Y2 + X2)), B = mod((Y1 + X1) * (Y2 - X2)), F = mod(B - A);
    if (F === _0n) return this.double();
    const C = mod(Z1 * _2n * T2), D = mod(T1 * _2n * Z2), E = D + C, G = B + A, H = D - C;
    return new Point(mod(E * F), mod(G * H), mod(F * G), mod(E * H));
  }
  double() {
    const { x: X1, y: Y1, z: Z1 } = this;
    const A = mod(X1 * X1), B = mod(Y1 * Y1), C = mod(_2n * mod(Z1 * Z1)), D = mod(-_1n * A), sum = X1 + Y1;
    const E = mod(mod(sum * sum) - A - B), G = D + B, F = G - C, H = D - B;
    return new Point(mod(E * F), mod(G * H), mod(F * G), mod(E * H));
  }
}
let point = new Point(15112221349535400772501151409588531511454012693041857206046113283949847762202n, 46316835694926478169428394003475163141307993866256225615783033603165251855960n, _1n, 46827403850823179245072216630277197565144205554125654976674165829533817101731n), other = point;
let hash = 7;
for (let i = 0; i < 300; i++) { const sum = point.add(other); if (i % 3) other = point.double(); point = sum; hash = digest(point.x.toString(16) + point.t.toString(16), hash); }
console.log(hash, point.y);

// What is kept stays as it was.
function keeps(a, b, rare) {
  const kept = [], s = a + b, p = s * s, r = p % CURVE.P, d = r - s;
  kept.push(s); const e = s - r; kept.push(() => e); const f = e * d; if (rare) kept.push(p, { f }, `${d}`); const g = f + p; kept.push(g % 1000003n);
  return kept;
}
function throwsIt(a, b) { const s = a * b + a; try { const t = s - b; if (t > 0n) throw t; return s + t; } catch (error) { return error * s - (s % 7n); } }
function joins(a, b, flag) { let r = a * b; if (flag & 1) r = r + a; else r = b - r; const t = r * 2n; let u; if (flag & 2) u = t; else u = r; return [u === t, u - r, u % 97n, t > u]; }
function callsItself(a, depth) { const s = a * 3n + 1n, t = s - a; const below = depth ? callsItself(t % 1000000007n, depth - 1) : 0n; return s * t - below + (t % 11n); }
for (let i = 0; i < 400; i++) {
  const a = random(next() % 24), b = random(next() % 24);
  const all = keeps(a, b, i % 7 === 0).map(k => typeof k === "function" ? k() : typeof k === "object" ? k.f : k);
  hash = digest(all.join() + throwsIt(a, b) + joins(a, b, i) + callsItself(a, i % 9), hash);
}
console.log(hash);

// Values that go around loops: alone, shifted, swapped, three at a time, read behind the new ones.
function power(x, n, m) { let result = 1n; while (n > 0n) { if (n & 1n) { result *= x; result %= m; } x *= x; x %= m; n >>= 1n; } return result; }
function squares(x, n) { let r = x; while (n-- > _0n) { r *= r; r %= CURVE.P; } return r; }
function invert(number, modulo) { let a = mod(number, modulo), b = modulo, x = _0n, y = _1n, u = _1n, v = _0n; while (a !== _0n) { const q = b / a, r = b % a, m = x - u * q, n = y - v * q; b = a, a = r, x = u, y = v, u = m, v = n; } return [b, mod(x, modulo), y]; }
function fibonacci(n, m) { let a = 0n, b = 1n; for (let i = 0; i < n; i++) { const c = (a + b) % m; a = b; b = c; } return a; }
function three(a, b, c, n) { for (let i = 0; i < n; i++) { const d = (a + b - c) % CURVE.P; const e = a - d; a = b; b = c; c = d; if (i % 5 === 0) { const t = a; a = c; c = t; } if (e === 0n) break; } return a * 3n + b * 5n + c; }
function older(a, n) { let before = 0n, sum = 0n; for (let i = 0; i < n; i++) { const now = (a * a + before) % CURVE.P; sum = (sum + before * now - a) % CURVE.P; before = a; a = now; } return sum - before; }
function grows(a, n) { let x = a; for (let i = 0; i < n; i++) x = x * x - x; return x; }
for (let i = 0; i < 120; i++) {
  const a = mod(random(8)) + 1n, b = random(next() % 20);
  hash = digest([power(a, BigInt(next()), CURVE.P), squares(b, BigInt(i % 40)), ...invert(a, CURVE.P), fibonacci(i * 5, (1n << BigInt(i * 5 + 1)) - 1n), three(a, b, a - b, i), older(a, i), grows(b % 1000n, i % 9)].join(), hash);
}
console.log(hash, squares(3n, 255n));

// Operands that are no BigInts.
const odd = [1, 2.5, "7", "x", null, undefined, true, { valueOf() { shown.push("v"); return 5n; } }, { [Symbol.toPrimitive]() { throw new RangeError("no"); } }, Symbol.iterator, [2n], 3n];
for (const f of [(a, b) => mod(a * b) - mod(a - b), (a, b) => { const s = a + b; return s * s - s; }, (a, b) => -(a - b) % 5n, (a, b) => invert(a, b).join(), (a, b) => three(a, b, a, 3), (a, b) => older(a, 2) - b, joins, throwsIt]) {
  const row = [];
  for (const a of odd) for (const b of odd) { try { const r = f(a, b, 3); row.push(typeof r + String(r)); } catch (error) { row.push(error instanceof Error ? error.name + error.message : String(error)); } }
  console.log(digest(row.join("|"), 5), shown.length);
}
