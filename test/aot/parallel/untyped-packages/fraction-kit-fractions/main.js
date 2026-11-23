// An untyped package and a program of it (fractions): exact fractions, big powers, primes and bases over BigInt; continued fractions and square roots
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const F = lib.Fraction, list = ['1/3', '-0.75', 0.1, 5n, '0.1(6)', '22/7', '-3', 2 ** -20, '123456789012345678901234567890/7', '0.(142857)']; let acc = new F(0n); for (let i = 0; i < 30; i++) { const a = F.of(list[i % 10]), b = F.of(list[(i * 3 + 1) % 10]); acc = i % 4 === 3 ? acc.mul(b.sub(a)) : i % 4 === 2 && acc.n ? a.div(acc) : acc.add(a); if (String(acc).length > 60) acc = new F(acc.floor() % 97n, 7n); say(i, acc, acc.decimal(), a.cmp(b), a.pow(i % 5 - 2), acc.floor(), a > b, +b, `${a}`, a + b > 1, JSON.stringify(acc)); } for (const bad of ['x', '1/0', NaN, '1.2.3', Infinity, '']) try { say(F.of(bad)); } catch (e) { say(e.name, e.message); } try { acc.n = 5n; } catch (e) { say(e.name); } say(F.of('415/93').continued().join(), F.convergents(F.of(Math.PI).continued(8)).join(' '), F.of('-7/3').continued().join());
