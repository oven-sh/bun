// A JSON text is joined behind texts that leave it just the room it takes below the longest string, a little more, or a little less.
type Plain = { label: string; count: number };
type Row = { label: string };
type Nested = { list: string[]; inner: { on: boolean; off: null; deep: { value: number }[] } };
function joinPlain(head: string, filler: string, rows: Plain[]): number {
  return (head + filler + JSON.stringify(rows)).length;
}
function joinRows(head: string, filler: string, rows: Row[]): number {
  return (head + filler + JSON.stringify(rows)).length;
}
function joinNumbers(head: string, filler: string, numbers: number[]): number {
  return (head + filler + JSON.stringify(numbers)).length;
}
function joinNested(head: string, filler: string, nested: Nested): number {
  return (head + filler + JSON.stringify(nested)).length;
}
function joinBetween(head: string, filler: string, rows: Plain[]): number {
  return (head + filler + "<" + JSON.stringify(rows) + ">").length;
}
function attempt(join: () => number): string {
  try {
    return String(join());
  } catch (error) {
    return (error as Error).name;
  }
}

const plain: Plain[] = [];
for (let i = 0; i < 300; i++) plain.push({ label: "row " + i, count: i * 1000 });
const escaped: Plain[] = [];
for (let i = 0; i < 300; i++) escaped.push({ label: 'row "' + i + '"\n', count: i / 4 });
const wide: Plain[] = [];
for (let i = 0; i < 300; i++) wide.push({ label: "日本 " + i, count: -i });
const long: Plain[] = [{ label: "y".repeat(100_000), count: 1 }, { label: "z".repeat(5000), count: 2 }];
const rows = JSON.parse(JSON.stringify(plain)) as Row[];
const numbers: number[] = [];
for (let i = 0; i < 3000; i++) numbers.push(i % 7 ? i : i + 0.5);
const nested: Nested = { list: [], inner: { on: true, off: null, deep: [] } };
for (let i = 0; i < 300; i++) {
  nested.list.push("item " + i);
  nested.inner.deep.push({ value: i });
}

const forms: [string, number, (head: string, filler: string) => number][] = [
  ["declared members", JSON.stringify(plain).length, (head, filler) => joinPlain(head, filler, plain)],
  ["texts with escapes", JSON.stringify(escaped).length, (head, filler) => joinPlain(head, filler, escaped)],
  ["wide texts", JSON.stringify(wide).length, (head, filler) => joinPlain(head, filler, wide)],
  ["long texts", JSON.stringify(long).length, (head, filler) => joinPlain(head, filler, long)],
  ["undeclared members", JSON.stringify(rows).length, (head, filler) => joinRows(head, filler, rows)],
  ["numbers", JSON.stringify(numbers).length, (head, filler) => joinNumbers(head, filler, numbers)],
  ["nested", JSON.stringify(nested).length, (head, filler) => joinNested(head, filler, nested)],
  ["between two texts", JSON.stringify(plain).length + 2, (head, filler) => joinBetween(head, filler, plain)],
];
let sum = 0;
for (let turn = 0; turn < 20; turn++) for (const [, , join] of forms) sum += join("head", "filler");
console.log(sum);

let piece = "x".repeat(1 << 16);
let head = "";
for (let bit = 16; bit < 31; bit++) {
  if (bit >= 22) head = head + piece;
  if (bit < 30) piece = piece + piece;
}
const left = 2 ** 31 - 1 - head.length;
console.log(head.length, left);
for (const [name, length, join] of forms) {
  let line = name + ":";
  for (const past of [-5000, -4200, -4097, -4096, -4095, -4094, -4093, -4092, -1000, -136, -129, -128, -127, -126, -125, -41, -40, -9, -8, -7, -2, -1, 0, 1, 2, 7, 8, 9, 127, 128, 4095, 4096, 4097, 5000]) {
    const answer = attempt(() => join(head, "f".repeat(left - length + past)));
    line += " " + past + (answer === String(2 ** 31 - 1 + past) ? " fits" : " " + answer);
  }
  console.log(line);
}
