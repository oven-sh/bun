// STATISTIC: RemaindersTestedAsIntegers >= 1
// A loop tests `n % x` where neither operand's type is known: integers that are not negative and a positive divisor are divided as integers, everything else as numbers.
const values = JSON.parse("[0, -0, 1, 2, 3, -3, 4, 6, 7, 0.5, 1.5, -1.5, 2147483647, -2147483648, 2147483648, 4294967295, 9007199254740992, 1e300, 1e-320, -1, 12, 30]");
values.push(NaN, Infinity, -Infinity);
const mixed = [...values, "6", "x", "", true, false, null, undefined, { valueOf() { return 6; } }, [4], 3n];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "o" : String(v);
function divisorsOf(n, list) { let out = ""; for (const x of list) { if (n % x) continue; out += show(x) + ","; } return out; }
function multiplesOf(x, list) { let out = ""; for (const n of list) { if (n % x === 0) out += show(n) + ","; } return out; }
function leavingOne(x, list) { let out = ""; for (const n of list) { if (n % x === 1) out += show(n) + ","; } return out; }
function leavingMinusThree(x, list) { let count = 0; for (const n of list) { if (n % x === -3) count++; } return count; }
function notZero(x, list) { let count = 0; for (const n of list) { if (n % x !== 0) count++; } return count; }
function looselyZero(x, list) { let count = 0; for (const n of list) { if (n % x == 0) count++; } return count; }
function inverted(n, list) { let out = ""; for (const x of list) out += !(n % x) ? "T" : "F"; return out; }
function chosen(n, list) { let out = ""; for (const x of list) out += n % x ? "T" : "F"; return out; }
function kept(n, list) { const out = []; for (const x of list) { const r = n % x; if (r) out.push(show(r)); else out.push("z" + show(r)); } return out.join(); }
function both(n, list) { let out = ""; for (const x of list) { if (n % x && x % n) out += show(x) + ","; } return out; }
function counted(n, list) { let k = 0; for (let i = 0; i < list.length; i++) { if (n % i === 0) k += i; if (i % n === 0) k += 100; } return k; }
function caught(n, list) { let out = ""; for (const x of list) { try { if (n % x) out += "T"; else out += "F"; } catch (e) { out += e.name[0]; } finally { out += "."; } } return out; }
function attempt(f, a, list) { try { return f(a, list); } catch (e) { return e.name; } }
for (const f of [divisorsOf, multiplesOf, leavingOne, leavingMinusThree, notZero, looselyZero, inverted, chosen, kept, both, counted, caught]) {
  for (const v of values) console.log(f.name, show(v), attempt(f, v, values));
  for (const v of mixed) console.log(f.name, show(v), attempt(f, v, mixed), attempt(f, v, values), attempt(f, v, [1, 2, 3, 4, 5, 6, 12]));
}
const isPrime = n => { for (let x = 2; x < n; x++) if (!(n % x)) return false; return n > 1; };
const gcd = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a; };
let primes = 0, sum = 0;
for (const n of Array.from({ length: 500 }, (_, i) => i)) { if (isPrime(n)) primes++; sum += gcd(n, 360); }
console.log(primes, sum, isPrime(8191), isPrime(2147483647 % 10007), gcd(2147483648, 4294967296), gcd(-12, 18), gcd(0.5, 0.25));
