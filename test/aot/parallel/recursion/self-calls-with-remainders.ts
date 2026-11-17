// Functions that call themselves with remainders, quotients and products that the caller cannot show to be what the parameter takes.
let calls = 0;
function power(b: number, e: number, acc: number): number { calls++; if (e === 0) return acc; if (e % 2 === 1) return power(b * b % 1009, (e - 1) / 2, acc * b % 1009); return power(b * b % 1009, e / 2, acc); }
function mixed(a: number, b: number, n: number): number { calls++; if (n === 0) return a * 2 - b; return mixed(a * b % 1000000007, (a + b) % 97, n - 1) + 1; }
function signed(a: number, b: number, n: number): number { calls++; if (n === 0) return a; return signed(-a * b % 10, b - 1, n - 1); }
function halves(a: number, n: number): number { calls++; if (n === 0) return a; return halves(a / 2, n - 1); }
function wide(a: number, n: number): number { calls++; if (n === 0) return a; return wide(a * a % 2147483648, n - 1); }
class Steps { static gcd(a: number, b: number): number { calls++; return b === 0 ? a : this.gcd(b, a % b); } }
const show = (x: number) => Object.is(x, -0) ? "-0" : String(x);
for (let i = 0; i < 40; i++) console.log(show(power(i, 1000 + i, 1)), show(mixed(i + 1, i * 48, i % 9)), show(signed(i, i % 5, i % 4)), show(halves(i, i % 6)), show(wide(i + 46340, i % 5)), show(Steps.gcd(i * 36, 48 + (i & 1))));
console.log(show(signed(0, 3, 1)), show(signed(5, 0, 1)), show(halves(0.5, 3)), show(wide(65536, 2)), calls);
