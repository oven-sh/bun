// Math.floor(a / b), Math.round(a * b), Math.trunc(a % b), Math.ceil(a / b): the usual way to stay with integers. For integers a and b the results still include
// NaN (0 / 0), the infinities (1 / 0), -0 (Math.ceil(-1 / 2), Math.round(-1 / 4), Math.trunc(-4 % 2), Math.floor(0 / -1)) and 2 ** 31 (-(2 ** 31) / -1). All operands pass through `| 0` first.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Quotient { floor = 0; ceil = 0; round = 0; trunc = 0; }
class Product { round = 0; abs = 0; }
class Remainder { trunc = 0; max = 0; }
function divide(o: Quotient, a: number, b: number) {
  const x = a | 0, y = b | 0;
  o.floor = Math.floor(x / y);
  o.ceil = Math.ceil(x / y);
  o.round = Math.round(x / y);
  o.trunc = Math.trunc(x / y);
}
function multiply(o: Product, a: number, b: number) {
  const x = a | 0, y = b | 0;
  o.round = Math.round(x * y);
  o.abs = Math.abs(x * y);
}
function remain(o: Remainder, a: number, b: number) {
  const x = a | 0, y = b | 0;
  o.trunc = Math.trunc(x % y);
  o.max = Math.max(x % y, -1);
}
function made<T extends object>(o: T) {
  handOver(o);
  return o;
}
const show = (o: object) => Object.values(o).map(exact).join(",") + " " + JSON.stringify(o) + " " + Object.values(o).map(value => exact(1 / value)).join(",");
let sum = 0;
for (let i = 1; i < 2000; i++) {
  const q = made(new Quotient()), p = made(new Product()), r = made(new Remainder());
  divide(q, i, 7);
  multiply(p, i & 255, 3);
  remain(r, i, 7);
  sum += q.floor + q.ceil + q.round + q.trunc + p.round + p.abs + r.trunc + r.max;
}
console.log("warm", sum);
const pairs: [number, number][] = JSON.parse("[[0,0],[1,0],[-1,0],[-1,2],[-1,4],[0,-1],[-4,2],[-2147483648,-1],[-2147483648,1],[2147483647,1],[65536,65536],[46341,46341],[-65536,32768],[0,-5],[7,2],[-7,2],[-2147483645,1]]");
for (const [a, b] of pairs) {
  const q = made(new Quotient()), p = made(new Product()), r = made(new Remainder());
  divide(q, a, b);
  multiply(p, a, b);
  remain(r, a, b);
  console.log(`${a}, ${b}: / ${show(q)} | * ${show(p)} | % ${show(r)}`);
}
