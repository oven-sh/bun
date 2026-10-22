// Sloppy CommonJS TypeScript. Every caller in sight passes a small integer, and the function stores its parameter into a number field. But in sloppy code `arguments[1] = v` writes the parameter,
// and text evaluated inside the function can assign to it too. Both get the value from a variable that is filled at run time.
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
class Box { n = 0; }
let replacement: number | undefined;
function throughArguments(box: Box, n: number) {
  if (replacement !== undefined) arguments[1] = replacement;
  box.n = n;
}
function throughArgumentsInAClosure(box: Box, n: number) {
  const all = arguments;
  const change = () => { if (replacement !== undefined) all[1] = replacement; };
  change();
  return () => { box.n = n; };
}
const assignment: string = JSON.parse('["n = ","replacement"]').join("");
function throughText(box: Box, n: number) {
  if (replacement !== undefined) eval(assignment);
  box.n = n;
}
function fresh() {
  const box = new Box();
  handOver(box);
  return box;
}
console.log("sloppy:", (function (this: unknown) { return this !== undefined; })());
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const a = fresh(), b = fresh(), c = fresh();
  throughArguments(a, i & 31);
  throughArgumentsInAClosure(b, i & 31)();
  throughText(c, i & 31);
  sum += a.n + b.n + c.n;
}
console.log("warm", sum);
for (const value of odd) {
  replacement = value;
  const a = fresh(), b = fresh(), c = fresh();
  throughArguments(a, 1);
  throughArgumentsInAClosure(b, 2)();
  throughText(c, 3);
  console.log(`${exact(value)}: ${exact(a.n)} ${exact(b.n)} ${exact(c.n)} ${[a, b, c].every(box => Object.is(box.n, value))} ${JSON.stringify([a, b, c])} ${exact(a.n + b.n)}`);
}
replacement = undefined;
const last = fresh();
throughArguments(last, 4);
console.log("afterwards:", exact(last.n));
