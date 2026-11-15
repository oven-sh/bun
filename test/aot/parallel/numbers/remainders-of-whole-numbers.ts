// Remainders of numbers that are whole: zero, negative zero, negative numbers, infinity, NaN, and numbers beyond 64 bits.
function wrap(x: number, width: number): number { return (x + width) % width; }
function gcd(a: number, b: number): number { while (b !== 0) { const t = a % b; a = b; b = t; } return a; }
function power(b: number, e: number, m: number): number { let r = 1; b %= m; while (e > 0) { if (e & 1) r = (r * b) % m; e >>= 1; b = (b * b) % m; } return r; }
class Torus { constructor(readonly width: number, readonly height: number) {} cell(x: number, y: number): number { return wrap(y, this.height) * this.width + wrap(x, this.width); } }
const show = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));
const whole = [0, 1, 2, 7, 12, 60, 2147483647, 2147483648, 4294967296, 9007199254740991, 9007199254740992, 1e19, 1e300, Infinity];
const numbers: number[] = []; for (const x of whole) numbers.push(Math.round(x), Math.floor(-x));
numbers.push(Math.trunc(NaN));
for (const a of numbers) { let text = show(a); for (const b of numbers) text += " " + show(a % b); console.log(text); }
for (const a of [12, 18, 1071, 4294967296, 0]) for (const b of [0, 5, 18, 462, 6442450944]) console.log(a, b, gcd(a, b), gcd(b, a));
console.log(power(3, 65537, 10007), power(7, 12, 1), power(10, 9, 1000003));
for (const t of [new Torus(5, 3), new Torus(1, 1), new Torus(0, 2), new Torus(-4, 7)]) { let text = ""; for (let y = -2; y < 5; y++) for (let x = -2; x < 7; x += 3) text += show(t.cell(x, y)) + " "; console.log(text); }
export {};
