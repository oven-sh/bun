// Two classes have a number field of the same name. In one every store in sight is a small integer, in the other they are fractions. Functions typed by an interface read the field of both kinds.
// No typed code moves a number from the wide field into the narrow one, but built-ins do: Object.assign from instance to instance, Reflect.get and Reflect.set, a spread that is assigned, entries that are copied.
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
interface Weighted { readonly weight: number }
class Narrow implements Weighted { weight = 1; tag = "n"; }
class Wide implements Weighted { weight = 1.5; tag = "w"; }
function weightOf(item: Weighted) {
  return item.weight;
}
function addUp(items: Weighted[]) {
  let sum = 0;
  for (const item of items) sum += item.weight;
  return sum;
}
function heaviest(items: Weighted[]) {
  return items.reduce((best, item) => (item.weight > best.weight ? item : best));
}
function setNarrow(item: Narrow, weight: number) {
  item.weight = weight;
}
function growNarrow(item: Narrow) {
  item.weight += item.weight;
}
function setWide(item: Wide, weight: number) {
  item.weight = weight;
}
function made<T extends object>(item: T) {
  handOver(item);
  return item;
}
const moves: [string, (from: Wide, to: Narrow) => void][] = [
  ["Object.assign", (from, to) => { Object.assign(to, from); }],
  ["Reflect", (from, to) => { Reflect.set(to, "weight", Reflect.get(from, "weight")); }],
  ["a spread", (from, to) => { Object.assign(to, { ...from }); }],
  ["entries", (from, to) => { for (const [key, value] of Object.entries(from)) (to as any)[key] = value; }],
  ["descriptors", (from, to) => { Object.defineProperties(to, Object.getOwnPropertyDescriptors(from)); }],
];
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const narrow = made(new Narrow()), wide = made(new Wide());
  setNarrow(narrow, i & 15);
  growNarrow(narrow);
  setWide(wide, (i & 15) + 0.5);
  sum += addUp([narrow, wide]) + weightOf(heaviest([narrow, wide]));
}
console.log("warm", sum);
for (const [label, move] of moves) {
  const lines: string[] = [];
  for (const value of odd) {
    const narrow = made(new Narrow()), wide = made(new Wide());
    setWide(wide, value);
    Reflect.apply(move, undefined, [wide, narrow]);
    const moved = `${Object.is(weightOf(narrow), value)} ${exact(narrow.weight)} ${JSON.stringify(narrow)} [${Object.keys(narrow)}]`;
    growNarrow(narrow);
    const grown = exact(narrow.weight);
    const total = exact(addUp([narrow, wide, made(new Narrow())]));
    setNarrow(narrow, 3);
    lines.push(`${moved} ${grown} ${total} ${exact(narrow.weight)}`);
  }
  console.log(label + ":", lines.join(" | "));
}
