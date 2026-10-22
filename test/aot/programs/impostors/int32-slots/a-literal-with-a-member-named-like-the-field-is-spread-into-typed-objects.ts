// A small literal has a member called `id`, like the number field of a class and of an interface, and holds a number that is no int32.
// It is spread into a typed literal and over one, a dictionary is spread and cast, and records made by Object.fromEntries and structuredClone are cast to the interface.
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
class Entity { id = 0; name = "e"; }
interface Row { id: number; name: string }
function idOf(row: Row) {
  return row.id;
}
function next(row: Row) {
  return row.id + 1;
}
function setId(row: Row, id: number) {
  row.id = id;
}
function show(row: Row) {
  return `${exact(idOf(row))} ${exact(next(row))} ${JSON.stringify(row)} [${Object.keys(row)}]`;
}
function entity() {
  const made = new Entity();
  handOver(made);
  return made;
}
function row(): Row {
  const made: Row = { id: 1, name: "r" };
  handOver(made);
  return made;
}
const ways: [string, (value: number) => Row][] = [
  ["a spread into a typed literal", value => { const table = { id: value }; const made: Row = { name: "s", ...table }; return made; }],
  ["a spread over a typed literal", value => { const table = { id: value }; const made: Row = { ...row(), ...table }; return made; }],
  ["a spread of a dictionary", value => { const table: Record<string, number> = { id: value }; return { name: "d", ...table } as unknown as Row; }],
  ["Object.fromEntries", value => Object.fromEntries([["id", value], ["name", "f"]]) as unknown as Row],
  ["structuredClone", value => structuredClone({ id: value, name: "k" }) as Row],
];
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const a = entity(), b = row();
  setId(a, i & 63);
  setId(b, i & 31);
  sum += idOf(a) + next(b);
}
console.log("warm", sum);
for (const [label, make] of ways) {
  console.log(label + ":");
  for (const value of odd) {
    const made = make(value);
    const first = show(made);
    setId(made, 3);
    console.log(`  ${exact(value)}: ${Object.is((made as any).id, 3)} ${first}`);
  }
}
