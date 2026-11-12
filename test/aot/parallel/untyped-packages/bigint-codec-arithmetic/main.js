// An untyped package and a program of it (arithmetic): varints, rationals, powers modulo, digits in any base
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
let sum = new lib.Rational(0), prod = new lib.Rational(1); for (let i = 1; i <= 22; i++) { const r = new lib.Rational(i % 3 ? 1 : -2, i); sum = sum.plus(r); prod = prod.times(r.plus(new lib.Rational(i, 7))); say(i, String(sum), sum.decimals(12), prod.compare(sum), (+sum).toFixed(6), String(r.over(new lib.Rational(i + 1, 3)))); }
try { new lib.Rational(1, 0); } catch (e) { say(e.message); } const primes = []; for (let k = 2n; k < 120n; k++) if (lib.isPrime(k)) primes.push(k); say(primes.join()); for (const n of [1000003n, 1000001n, (1n << 61n) - 1n, (1n << 67n) - 1n, 561n]) say(n, lib.isPrime(n), lib.power(3n, n - 1n, n), lib.gcd(n, 1001n));
