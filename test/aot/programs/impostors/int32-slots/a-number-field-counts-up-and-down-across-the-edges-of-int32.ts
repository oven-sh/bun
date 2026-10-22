// `counter.n++`, `--counter.n`, `counter.n += k`, `counter.n -= k` and `counter.n += counter.n`, on fields that start at small integers: sums of integers look like integers.
// The starting points come from a text at run time and lie a few steps from 2 ** 31 - 1 and from -(2 ** 31) + 5, below which a narrow slot may keep its own marks. Every step is printed.
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
class Counter { n = 0; other = 1; }
interface Plain { n: number }
function up(counter: Counter) { return counter.n++; }
function down(counter: Counter) { return --counter.n; }
function add(counter: Counter, k: number) { counter.n += k; }
function subtract(counter: Counter, k: number) { counter.n -= k; }
function double(counter: Counter) { counter.n += counter.n; }
function upPlain(plain: Plain) { plain.n = plain.n + 1; }
function manyUp(counter: Counter, rounds: number) {
  for (let i = 0; i < rounds; i++) counter.n++;
  return counter.n;
}
function manyDown(counter: Counter, rounds: number) {
  let last = 0;
  for (let i = 0; i < rounds; i++) last = counter.n -= 1;
  return last;
}
function startAt(n: number) {
  const counter = new Counter();
  handOver(counter);
  Reflect.set(counter, "n", n);
  return counter;
}
function show(counter: Counter) {
  return `${exact(counter.n)}${Number.isInteger(counter.n) && typeof counter.n === "number" ? "" : "!"}`;
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const counter = new Counter();
  handOver(counter);
  up(counter);
  add(counter, i & 15);
  double(counter);
  subtract(counter, 2);
  down(counter);
  const plain: Plain = { n: i & 7 };
  handOver(plain);
  upPlain(plain);
  sum += counter.n + manyUp(counter, 3) + manyDown(counter, 2) + plain.n;
}
console.log("warm", sum);
const [top, bottom]: number[] = JSON.parse("[2147483644,-2147483640]");
{
  const counter = startAt(top);
  const steps: string[] = [];
  for (let i = 0; i < 7; i++) steps.push(`${exact(up(counter))}>${show(counter)}`);
  console.log("up:", steps.join(" "), JSON.stringify(counter));
  steps.length = 0;
  for (let i = 0; i < 7; i++) steps.push(`${exact(down(counter))}=${show(counter)}`);
  console.log("and down again:", steps.join(" "), JSON.stringify(counter));
}
{
  const counter = startAt(bottom);
  const steps: string[] = [];
  for (let i = 0; i < 12; i++) steps.push(`${exact(down(counter))}=${show(counter)}`);
  console.log("down:", steps.join(" "), JSON.stringify(counter), Object.keys(counter).join());
  steps.length = 0;
  for (let i = 0; i < 12; i++) steps.push(`${exact(up(counter))}>${show(counter)}`);
  console.log("and up again:", steps.join(" "), JSON.stringify(counter));
}
console.log("in a loop:", exact(manyUp(startAt(top), 10)), exact(manyDown(startAt(bottom), 15)), exact(manyUp(startAt(bottom - 12), 20)), exact(manyDown(startAt(top + 8), 20)));
for (const k of JSON.parse("[1,3,4,5,1073741824,2147483647]") as number[]) {
  const a = startAt(top), b = startAt(bottom);
  add.call(undefined, a, k);
  subtract.call(undefined, b, k);
  console.log(`by ${k}: ${show(a)} ${show(b)}`);
}
{
  const counter = startAt(1);
  const steps: string[] = [];
  for (let i = 0; i < 33; i++) {
    double(counter);
    if (i > 27) steps.push(show(counter));
  }
  console.log("doubled:", steps.join(" "));
  const negative = startAt(-1);
  steps.length = 0;
  for (let i = 0; i < 33; i++) {
    double(negative);
    if (i > 27) steps.push(show(negative));
  }
  console.log("doubled below zero:", steps.join(" "));
}
{
  const plain: Plain = { n: 1 };
  handOver(plain);
  Reflect.set(plain, "n", top + 2);
  const steps: string[] = [];
  for (let i = 0; i < 4; i++) {
    upPlain(plain);
    steps.push(exact(plain.n));
  }
  console.log("a literal:", steps.join(" "), JSON.stringify(plain));
}
for (const value of odd) {
  const counter = startAt(value);
  const before = show(counter);
  const returned = up(counter);
  console.log(`${exact(value)}: ${before} ++ ${exact(returned)} ${show(counter)} ${Object.is(counter.n, value + 1)}`);
}
