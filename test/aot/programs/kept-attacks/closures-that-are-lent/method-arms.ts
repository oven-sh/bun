// Closures that are lent: method arms. It prints what plain Bun prints.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "") as <T>(list: T[], i: number) => T;
class Celsius { constructor(public degrees: number) {} of(n: number): number { return this.degrees + n; } }
class Kelvin { constructor(public degrees: number) {} of(n: number): number { return this.degrees + n + 273; } }
const scales: (Celsius | Kelvin)[] = [new Celsius(1), new Kelvin(2), new Celsius(3)];
function callIt(i: number, n: number): number { const s = pick(scales, i % 3); return s.of(n); }
function callOne(i: number, n: number): number { const s = pick(scales, 0) as Celsius; return s.of(n) + 1; }
let sum = 0;
for (let i = 0; i < 6000; i++) sum += callIt(i, i) + callOne(i, 2);
console.log(sum);
