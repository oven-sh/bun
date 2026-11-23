// An untyped package and a program of it (numbers): exact fractions, big powers, primes and bases over BigInt; continued fractions and square roots
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
for (let i = 0n; i < 24n; i++) { const n = (i * 1234567891n) ** (i % 5n + 1n) + i, p = 1000003n; say(i, lib.modpow(n, i * 7n + 3n, p), lib.isPrime(i), lib.isPrime((1n << i) - 1n), lib.isqrt(n), lib.isqrt(n * n) === n, lib.toBase(n), lib.fromBase(lib.toBase(n)) === n, lib.toBase(n, '01').length, lib.gcd(n, 360360n), n.toString(36), BigInt.asIntN(32, n), BigInt.asUintN(16, -n)); try { say(lib.inverse(i, 12n)); } catch (e) { say(e.message); } } say(lib.pi(50)); say(lib.isPrime(2n ** 61n - 1n), lib.isPrime(2n ** 67n - 1n), [...'0OIl'].map(c => { try { return lib.fromBase('1' + c); } catch (e) { return e.message; } }).join()); say([7n, -7n].map(a => [2n, -2n].map(b => [a / b, a % b, a << b, a >> b, a & b, a | b, a ^ b, ~a].join()).join(' ')).join(' | '), 1n < 1.5, 2n == '2', 1n + BigInt(true), typeof Object(1n), [3n, 1, 2n, '0'].sort().join());
