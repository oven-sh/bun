// A JSON text is joined behind texts that leave it a little less room than it takes below the longest string.
// Flags: --aot-validate
type Row = { label: string; count: number };
type Nested = { list: string[]; inner: { on: boolean; off: null; deep: { value: number }[] } };
function joinNested(head: string, filler: string, nested: Nested): number {
  return (head + filler + JSON.stringify(nested)).length;
}
function joinBetween(head: string, filler: string, rows: Row[]): number {
  return (head + filler + "<" + JSON.stringify(rows) + ">").length;
}
function attempt(join: () => number): string {
  try {
    return String(join());
  } catch (error) {
    return (error as Error).name;
  }
}
const rows: Row[] = [];
for (let i = 0; i < 300; i++) rows.push({ label: "row " + i, count: i * 1000 });
const nested: Nested = { list: [], inner: { on: true, off: null, deep: [] } };
for (let i = 0; i < 300; i++) {
  nested.list.push("item " + i);
  nested.inner.deep.push({ value: i });
}
const forms: [string, number, (head: string, filler: string) => number][] = [
  ["nested", JSON.stringify(nested).length, (head, filler) => joinNested(head, filler, nested)],
  ["between two texts", JSON.stringify(rows).length + 2, (head, filler) => joinBetween(head, filler, rows)],
];
let piece = "x".repeat(1 << 16);
let head = "";
for (let bit = 16; bit < 31; bit++) {
  if (bit >= 22) head = head + piece;
  if (bit < 30) piece = piece + piece;
}
const left = 2 ** 31 - 1 - head.length;
for (const [name, length, join] of forms) {
  let line = name + ":";
  for (const past of [-128, -9, -1, 0, 1, 2, 7, 8, 9, 127, 128, 4096]) line += " " + past + " " + attempt(() => join(head, "f".repeat(left - length + past)));
  console.log(line);
}
