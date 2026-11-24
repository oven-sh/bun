// r = a % m; r >= zero ? r : m + r, in loops and in functions that loops call: signs of both, zero remainders, divisors that are negative, zeros that are no zero, variables that change, other uses of the remainder, other sums.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=60
let seed = 61;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 0; }
function digest(text, hash) { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
function random(words) { let value = 0n; for (let i = 0; i < words; i++) { const kind = next() % 6; value = (value << 32n) | BigInt(kind === 0 ? 0 : kind === 1 ? 0xffffffff : next()); } return next() & 1 ? value : -value; }
const files = {
  inFunction(where) {
    const _0n = BigInt(0), one = BigInt(1), low = -(BigInt(1) << BigInt(200)), P = (1n << 255n) - 19n, N = 2n ** 256n - 2n ** 32n - 977n, M = (1n << 130n) - 5n;
    let changing = 0n, divisor = P;
    const list = [];
    function literal(a, m) { const r = a % m; return r >= 0n ? r : m + r; }
    function constant(a, m) { const r = a % m; return r >= _0n ? r : m + r; }
    function swapped(a, m) { const r = a % m; return r >= _0n ? r : r + m; }
    function aboveLow(a, m) { const r = a % m; return r >= low ? r : m + r; }
function aboveOne(a, m) { const r = a % m; return r >= one ? r : m + r; }
    function variable(a, m) { const r = a % m; return r >= changing ? r : m + r; }
    function greater(a, m) { const r = a % m; return r > _0n ? r : m + r; }
    function otherSum(a, m) { const r = a % m; return r >= _0n ? r : P + r; }
    function otherUse(a, m) { const r = a % m; list[0] = r; return r >= _0n ? r : m + r; }
    function usedAfter(a, m) { const r = a % m; const s = r >= _0n ? r : m + r; return s - r; }
    function twice(a, m) { const r = a % m; return r >= _0n ? r : m + r + m; }
    function byDefault(a, m = divisor) { const r = a % m; return r >= _0n ? r : m + r; }
    function product(a, b, m) { const r = (a * b) % m; return r >= _0n ? r : m + r; }
    function chain(a, b, m) { const c = product(a - b, a + b, m), d = literal(a - c, m), e = constant(b - d, m); return swapped(c * d - e * a, m) - literal(d - e, m); }
    const functions = [literal, constant, swapped, aboveLow, aboveOne, variable, greater, otherSum, otherUse, usedAfter, twice, byDefault];
    const values = [0n, 1n, -1n, P, -P, P - 1n, 1n - P, 2n * P, -2n * P, N, -N, P * P, -P * P, P * N + 1n, -(P * N) - 1n, M, -M, 5n, -5n, (1n << 64n) - 1n, -(1n << 64n)];
    for (let i = 0; i < 40; i++) values.push(random(next() % 17));
    let hash = 7;
    for (const m of [P, N, M, -P, 7n, -7n, (1n << 256n) - 189n, (1n << 64n) - 59n, (1n << 521n) - 1n, 1n, -1n]) {
      divisor = m;
      for (let round = 0; round < 3; round++) {
        changing = round === 1 ? 3n : round === 2 ? -(1n << 200n) : 0n;
        let x = values[next() % values.length];
        for (let i = 0; i < 130; i++) x = product(x, x + 1n, m) - 1n;
        for (const a of values) {
          for (const f of functions) hash = (Math.imul(hash, 31) + Number(BigInt.asIntN(32, f(a, m))) + Number(BigInt.asIntN(32, f(-a * 3n + x, m) >> 70n))) | 0;
          const b = values[next() % values.length]; hash = digest(`${literal(a, m)},${constant(b, m)},${swapped(a, m)},${aboveLow(a, m)},${aboveLow(a - b, m)},${aboveOne(a, m)},${variable(a, m)},${greater(a, m)},${otherSum(a, m)},${otherUse(a, m)},${usedAfter(a, m)},${twice(a, m)},${byDefault(a)}`, hash);
          hash = digest(`${product(a, b, m)},${product(-a, b, m)},${chain(a, b, m)},${chain(b - a, x, m)}`, hash);
          for (let n = 0, y = a - b; n < 3; n++) { const r = (y * b) % m; y = (r >= 0n ? r : m + r) - a; if (y >= P) list.push(y); hash = (hash + Number(BigInt.asIntN(32, y))) | 0; }
        }
      }
      console.log(where, m.toString(16).length, hash, String(list[0]).length, list.length);
    }
    for (const [a, m] of [[5n, 0n], [5, 3n], [5n, 3], [-5, 3], [-5.5, 3], ["-5", 3], [undefined, 3n], [{ valueOf() { changing = 9n; return -5n; } }, 3n], [-5n, { valueOf() { return 3n; } }], [Symbol.iterator, 3n], [-5n, null]]) {
      const row = [];
      for (const f of functions) { try { const r = f(a, m); row.push(typeof r + String(r)); } catch (error) { row.push(error.name + error.message); } }
      console.log(where, digest(row.join("|"), 3), row[0], row[4]);
    }
  },
};
files[["in", "Function"].join("")]("function");
const _0n = BigInt(0), one = BigInt(1), low = -(BigInt(1) << BigInt(200)), P = (1n << 255n) - 19n, N = 2n ** 256n - 2n ** 32n - 977n, M = (1n << 130n) - 5n;
let changing = 0n, divisor = P;
const list = [];
function literal(a, m) { const r = a % m; return r >= 0n ? r : m + r; }
function constant(a, m) { const r = a % m; return r >= _0n ? r : m + r; }
function swapped(a, m) { const r = a % m; return r >= _0n ? r : r + m; }
function aboveLow(a, m) { const r = a % m; return r >= low ? r : m + r; }
function aboveOne(a, m) { const r = a % m; return r >= one ? r : m + r; }
function variable(a, m) { const r = a % m; return r >= changing ? r : m + r; }
function greater(a, m) { const r = a % m; return r > _0n ? r : m + r; }
function otherSum(a, m) { const r = a % m; return r >= _0n ? r : P + r; }
function otherUse(a, m) { const r = a % m; list[0] = r; return r >= _0n ? r : m + r; }
function usedAfter(a, m) { const r = a % m; const s = r >= _0n ? r : m + r; return s - r; }
function twice(a, m) { const r = a % m; return r >= _0n ? r : m + r + m; }
function byDefault(a, m = divisor) { const r = a % m; return r >= _0n ? r : m + r; }
function product(a, b, m) { const r = (a * b) % m; return r >= _0n ? r : m + r; }
function chain(a, b, m) { const c = product(a - b, a + b, m), d = literal(a - c, m), e = constant(b - d, m); return swapped(c * d - e * a, m) - literal(d - e, m); }
const functions = [literal, constant, swapped, aboveLow, aboveOne, variable, greater, otherSum, otherUse, usedAfter, twice, byDefault];
const values = [0n, 1n, -1n, P, -P, P - 1n, 1n - P, 2n * P, -2n * P, N, -N, P * P, -P * P, P * N + 1n, -(P * N) - 1n, M, -M, 5n, -5n, (1n << 64n) - 1n, -(1n << 64n)];
for (let i = 0; i < 40; i++) values.push(random(next() % 17));
let hash = 7;
for (const m of [P, N, M, -P, 7n, -7n, (1n << 256n) - 189n, (1n << 64n) - 59n, (1n << 521n) - 1n, 1n, -1n]) {
  divisor = m;
  for (let round = 0; round < 3; round++) {
    changing = round === 1 ? 3n : round === 2 ? -(1n << 200n) : 0n;
    let x = values[next() % values.length];
    for (let i = 0; i < 130; i++) x = product(x, x + 1n, m) - 1n;
    for (const a of values) {
      for (const f of functions) hash = (Math.imul(hash, 31) + Number(BigInt.asIntN(32, f(a, m))) + Number(BigInt.asIntN(32, f(-a * 3n + x, m) >> 70n))) | 0;
      const b = values[next() % values.length]; hash = digest(`${literal(a, m)},${constant(b, m)},${swapped(a, m)},${aboveLow(a, m)},${aboveLow(a - b, m)},${aboveOne(a, m)},${variable(a, m)},${greater(a, m)},${otherSum(a, m)},${otherUse(a, m)},${usedAfter(a, m)},${twice(a, m)},${byDefault(a)}`, hash);
      hash = digest(`${product(a, b, m)},${product(-a, b, m)},${chain(a, b, m)},${chain(b - a, x, m)}`, hash);
      for (let n = 0, y = a - b; n < 3; n++) { const r = (y * b) % m; y = (r >= 0n ? r : m + r) - a; if (y >= P) list.push(y); hash = (hash + Number(BigInt.asIntN(32, y))) | 0; }
    }
  }
  console.log("file", m.toString(16).length, hash, String(list[0]).length, list.length);
}
for (const [a, m] of [[5n, 0n], [5, 3n], [5n, 3], [-5, 3], [-5.5, 3], ["-5", 3], [undefined, 3n], [{ valueOf() { changing = 9n; return -5n; } }, 3n], [-5n, { valueOf() { return 3n; } }], [Symbol.iterator, 3n], [-5n, null]]) {
  const row = [];
  for (const f of functions) { try { const r = f(a, m); row.push(typeof r + String(r)); } catch (error) { row.push(error.name + error.message); } }
  console.log("file", digest(row.join("|"), 3), row[0], row[4]);
}
