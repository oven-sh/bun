// The captured number goes a longer way before it is stored: through two nested closures, a method of an object literal, an arrow function in a class field,
// a default value of a parameter, a generator and an async function. In sight there are only small integers; a hidden caller of each maker brings the other numbers.
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
class Cell { n = 0; }
function nested(cell: Cell, n: number) {
  return () => () => { cell.n = n; };
}
function method(cell: Cell, n: number) {
  return { run() { cell.n = n; } };
}
class Holder {
  constructor(public cell: Cell, private n: number) {}
  run = () => { this.cell.n = this.n; };
}
function byDefault(cell: Cell, n: number) {
  return (value = n) => { cell.n = value; };
}
function* generated(cell: Cell, n: number) {
  yield 1;
  cell.n = n;
}
async function awaited(cell: Cell, n: number) {
  await null;
  cell.n = n;
}
function fresh() {
  const cell = new Cell();
  handOver(cell);
  return cell;
}
const ways: [string, (cell: Cell, n: number) => unknown, (cell: Cell, n: number) => unknown][] = [
  ["nested", (cell, n) => nested(cell, n)()(), (cell, n) => nested.call(undefined, cell, n)()()],
  ["a method", (cell, n) => method(cell, n).run(), (cell, n) => method.apply(undefined, [cell, n]).run()],
  ["a class field", (cell, n) => new Holder(cell, n).run(), (cell, n) => Reflect.construct(Holder, [cell, n]).run()],
  ["a default", (cell, n) => byDefault(cell, n)(), (cell, n) => byDefault.bind(undefined, cell)(n)()],
  ["a generator", (cell, n) => [...generated(cell, n)], (cell, n) => [...Reflect.apply(generated, undefined, [cell, n])]],
  ["an async function", (cell, n) => awaited(cell, n), (cell, n) => awaited.call(undefined, cell, n)],
];
let sum = 0;
for (let i = 0; i < 1000; i++) {
  for (const [, seen] of ways) {
    const cell = fresh();
    await seen(cell, i & 127);
    sum += cell.n;
  }
}
console.log("warm", sum);
for (const [label, , hidden] of ways) {
  const line: string[] = [];
  for (const value of odd) {
    const cell = fresh();
    await hidden(cell, value);
    line.push(`${exact(cell.n)}${Object.is(cell.n, value) ? "" : " WRONG, wanted " + exact(value)} ${exact(cell.n - 1)} ${JSON.stringify(cell)}`);
  }
  console.log(label + ":", line.join(" | "));
}
