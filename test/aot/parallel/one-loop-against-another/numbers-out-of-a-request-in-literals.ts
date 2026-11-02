// Numbers come out of a parsed text, are put into fields of new objects and read again. They are fractions: a turn takes what it takes with small integers.
// COUNT: operations <= 80
// COUNT: arrivals <= 20
// COUNT: cells <= 3600
// COUNT: branches <= 24000
type Pair = { a: number; b: number };
type Row = { v: number };
function make(kept: Pair[], turns: number, rows: Row[]) {
  for (let turn = 0; turn < turns; turn++) kept[turn & 1023] = { a: rows[turn & 7]!.v, b: rows[turn & 7]!.v };
}
function read(kept: Pair[], turns: number) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += kept[turn & 1023]!.a - kept[turn & 1023]!.b + 1;
  return sum;
}
const texts: Record<string, string> = {
  "small integers": "7",
  "integers past 2 ** 32": "4294967303",
  "fractions": "7.5",
  "negative zeros": "-0",
};
const [loop = "make fractions", turns = "2500"] = process.argv.slice(2);
const [verb, kind] = [loop.slice(0, 4), loop.slice(5)];
const rows: Row[] = JSON.parse("[" + Array(8).fill(`{"v":${texts[kind]}}`).join() + "]");
if (rows.length !== 8) rows.push({ v: 1 });
const kept: Pair[] = [];
for (let index = 0; index < 1024; index++) kept.push({ a: index, b: index });
make(kept, verb === "make" ? Number(turns) : 1024, rows);
console.log(
  read(kept, verb === "read" ? Number(turns) : 1024),
  kept[5]!.a,
  Object.is(kept[5]!.b, -0),
  Object.keys(kept[5]!).join(),
);
