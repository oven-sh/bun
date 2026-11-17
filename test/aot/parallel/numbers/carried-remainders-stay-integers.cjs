// STATISTIC: CarriedDivisorsKeptIntegral >= 4
// while (b) [a, b] = [b, a % b]: a remainder of integers is an integer below its divisor. base %= modulus before a loop over the bits of an exponent.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v));
function gcd(a, b) {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function gcdTested(a, b) {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function gcdPositive(a, b) {
  for (; b > 0; ) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function gcdPair(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
function steps(a, b) {
  let n = 0;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
    n++;
  }
  return n + a / 1024;
}
function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}
function power(base, exponent, modulus) {
  let result = 1;
  base %= modulus;
  while (exponent > 0) {
    if (exponent & 1) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exponent >>= 1;
  }
  return result;
}
function typed(n) {
  let s = 0;
  for (let i = 1; i < n; i++) s += gcd(i * 12 + 36, 720) + gcdTested(i, 360) + gcdPositive(1000 - i, i) + gcdPair(i * 1000003, i + 1) + lcm(i, 12) + steps(i, 89);
  return s;
}
console.log(show(typed(400)));
function falling(n) {
  let s = 0;
  for (let i = -20; i < n; i++) s += gcd(i, 12) * 1000 + gcdTested(12, i) + gcdPair(i, i - 3) / 3;
  return s;
}
console.log(show(falling(60)));
const values = [0, 1, 2, 3, 12, 18, 97, 1071, 462, 2147483647, 2147483648, 4294967295, 9007199254740991, 9007199254740992, -0, -1, -12, -18, -2147483648, 0.5, 1.5, -2.5, 1e21, 1e300, 5e-324, NaN, Infinity, -Infinity, "12", "x", "", null, undefined, true, false, 12n, 18n, { valueOf: () => 24 }, [36]];
for (const of of [gcd, gcdTested, gcdPositive, gcdPair, steps, lcm]) {
  const said = [];
  for (const a of values) {
    for (const b of values) {
      if (typeof a === "number" && typeof b === "number" && (a === 1e300 || b === 1e300) && (a === 5e-324 || b === 5e-324)) continue;
      if (of !== gcd && of !== gcdPair && (typeof a === "bigint" || typeof b === "bigint")) continue;
      if (of === gcdTested && !(Number.isFinite(a) && Number.isFinite(b))) continue;
      try {
        said.push(show(of(a, b)));
      } catch (e) {
        said.push(e.constructor.name);
      }
    }
  }
  console.log(of.name, said.join());
}
const bases = [0, 1, 2, 3, 10006, 10007, 10008, 123456789, -1, -3, -10007, -0, 0.5, 2.75, 1e15, 9007199254740991, NaN, Infinity, "3", null, undefined, true, { valueOf: () => 5 }];
const exponents = [0, 1, 2, 13, 1000, 2147483647, 2147483648, 4294967297, -1, 0.5, 2.5, NaN, "10", null, undefined];
const moduli = [1, 2, 10007, 94906265, 94906267, 1000000007, 4294967296, 0, -7, 0.5, 2.5, NaN];
for (const m of moduli) {
  const said = [];
  for (const b of bases) for (const e of exponents) said.push(show(power(b, e, m)));
  console.log(m, said.join());
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum += power(3 + (i % 7), 1000 + (i % 100), 10007) + power(i - 1500, i, 997) * 0.5;
console.log(show(sum));
