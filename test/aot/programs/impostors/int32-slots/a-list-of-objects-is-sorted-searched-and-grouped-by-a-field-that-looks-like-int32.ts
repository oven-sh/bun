// A hundred records are sorted, searched, summed, grouped and put into sets and maps by a number field whose visible stores are all small integers.
// A few of the records got their number by a store that the build cannot attribute: fractions between the integers, -0 beside 0, integers beyond int32, an infinity.
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
class Rec {
  rank = 0;
  constructor(public name: string) {}
}
function byRank(a: Rec, b: Rec) {
  return a.rank - b.rank;
}
function names(list: Rec[]) {
  return list.map(rec => rec.name).join("");
}
function build(extra: [string, number][]) {
  const list: Rec[] = [];
  for (let i = 0; i < 10; i++) {
    const rec = new Rec(String.fromCharCode(97 + i));
    handOver(rec);
    rec.rank = (i * 7) % 10;
    list.push(rec);
  }
  for (const [name, rank] of extra) {
    const rec = new Rec(name);
    handOver(rec);
    Object.assign(rec, JSON.parse(`{"rank":${rank}}`));
    if (name === "Z") Reflect.set(rec, "rank", -0);
    if (name === "I") Reflect.set(rec, "rank", Infinity);
    list.push(rec);
  }
  return list;
}
function study(list: Rec[]) {
  const sorted = list.slice().sort(byRank);
  const total = list.reduce((sum, rec) => sum + rec.rank, 0);
  const largest = list.reduce((max, rec) => Math.max(max, rec.rank), -Infinity);
  const smallest = list.reduce((min, rec) => Math.min(min, rec.rank), Infinity);
  const distinct = new Set(list.map(rec => rec.rank)).size;
  const groups = Object.entries(Object.groupBy(list, rec => (Number.isInteger(rec.rank) ? (rec.rank | 0) === rec.rank ? "int32" : "integer" : "other"))).map(([group, members]) => group + ":" + names(members!)).join(" ");
  const found = list.find(rec => rec.rank === 3)?.name;
  const zeros = list.filter(rec => rec.rank === 0).map(rec => rec.name + (Object.is(rec.rank, -0) ? "-" : "+")).join("");
  const between = list.filter(rec => rec.rank > 2 && rec.rank < 4).map(rec => rec.name).join("");
  const index = new Map(list.map(rec => [rec.rank, rec.name]));
  return `${names(sorted)} ${exact(total)} ${exact(largest)} ${exact(smallest)} ${distinct} ${groups} ${found} ${zeros} ${between} ${index.get(2.5)} ${index.get(0)} ${index.get(2147483648)} ${index.size}`;
}
let length = 0;
for (let i = 0; i < 300; i++) length += study(build([])).length;
console.log("warm", length);
console.log("integers only:", study(build([])));
console.log("with strangers:", study(build([["P", 2.5], ["Q", 3.5], ["R", 2147483648], ["S", -2147483648], ["T", -2147483645], ["Z", 0], ["U", 1e21], ["V", -0.5]])));
console.log("with an infinity:", study(build([["I", 0], ["W", 4294967296]])));
