// id(), checkDefined(), orElse(), pick(), tap(), last(), first() and singleOrUndefined() are generic: the same functions pass objects, strings and numbers through, and their results are stored into number fields.
// Wherever the build looks, the numbers are small integers. A hidden caller of the function that fills the fields brings the others, through the very same helpers.
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
function id<T>(x: T): T {
  return x;
}
function checkDefined<T>(x: T | undefined | null): T {
  if (x === undefined || x === null) throw new Error("not defined");
  return x;
}
function orElse<T>(x: T | undefined, fallback: T): T {
  return x ?? fallback;
}
function pick<T>(flag: boolean, a: T, b: T): T {
  return flag ? a : b;
}
function tap<T>(x: T, look: (x: T) => void): T {
  look(x);
  return x;
}
function last<T>(a: T, b: T, c: T): T {
  let result = a;
  for (const next of [b, c]) result = next;
  return result;
}
function first<T>(list: readonly T[]): T {
  return list[0];
}
function singleOrUndefined<T>(list: readonly T[]): T | undefined {
  return list.length === 1 ? list[0] : undefined;
}
class Filled { a = 0; b = 0; c = 0; d = 0; e = 0; f = 0; g = 0; }
class FromLists { h = 0; i = 0; }
function fillFromLists(o: FromLists, n: number) {
  o.h = first([n, 1]);
  o.i = singleOrUndefined([n]) ?? 0;
}
let looked = 0;
function fill(o: Filled, n: number) {
  o.a = id(n);
  o.b = checkDefined(n);
  o.c = orElse(n, 0);
  o.d = pick(looked >= 0, n, 1);
  o.e = tap(n, () => { looked++; });
  o.f = id(id(checkDefined(orElse(id(n), 2))));
  o.g = id(n) + id(1);
}
function fresh() {
  const o = new Filled();
  handOver(o);
  return o;
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const o = fresh();
  fill(o, i & 63);
  sum += o.a + o.b + o.c + o.d + o.e + o.f + o.g;
  const lists = new FromLists();
  handOver(lists);
  fillFromLists(lists, i & 63);
  sum += lists.h + lists.i + first(["ab"]).length + first([{ k: 3 }]).k;
  sum += id("text").length + checkDefined({ k: 1 }).k + orElse<string>(undefined, "ab").length + pick(true, [1], [2, 3]).length + tap({ k: 2 }, () => {}).k + last("a", "bc", "def").length + last(1, 2, 3);
}
console.log("warm", sum, looked);
for (const value of odd) {
  const o = fresh();
  fill.call(undefined, o, value);
  const right = [o.a, o.b, o.c, o.d, o.e, o.f].every(stored => Object.is(stored, value)) && Object.is(o.g, value + 1);
  const lists = new FromLists();
  handOver(lists);
  fillFromLists.call(undefined, lists, value);
  console.log(`${exact(value)}: ${right} ${Object.values(o).map(exact).join(",")} ${JSON.stringify(o)} [${Object.keys(o)}] ${exact(o.a + o.b)} | ${Object.is(lists.h, value)} ${Object.is(lists.i, value)} ${JSON.stringify(lists)}`);
}
const o = fresh();
fill(o, 5);
console.log("an ordinary one afterwards:", JSON.stringify(o));
