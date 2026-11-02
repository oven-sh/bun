// The text grows past the longest string inside a try. The handler in the same function reads what the function made before.
type Row = { label: string; count: number };
class Kept {
  constructor(
    public name: string,
    public list: number[],
    public view: Uint32Array,
    public inner: { deep: string },
  ) {}
}
const sink: unknown[] = [];
function tooLong(head: string, filler: string, rows: Row[], turns: number, seed: number): string {
  const kept = new Kept("kept" + seed, [seed + 0.5, seed + 1.5, seed + 2.5], new Uint32Array([seed, seed + 1]), {
    deep: "deep" + seed,
  });
  const fractions = [seed + 0.25, seed + 0.75];
  const words = ["a" + seed, "b" + seed];
  const closure = () => "closure" + seed;
  const built = "built" + seed + filler.length;
  let sum = 0;
  let text = head;
  try {
    for (let i = 0; i < fractions.length; i++) sum += fractions[i] + kept.list[i] + kept.view[i];
    for (let i = 0; i < turns; i++) text += filler;
    text += JSON.stringify(rows);
    return "length " + text.length;
  } catch (error) {
    for (let i = 0; i < fractions.length; i++) sum += fractions[i] + kept.list[i] + kept.view[i];
    sink.push(kept, fractions, words, closure);
    return [
      (error as Error).name,
      kept.name,
      kept.list.join(),
      kept.view.join(),
      kept.inner.deep,
      fractions.join(),
      words.join(),
      closure(),
      built,
      sum,
    ].join(" ");
  }
}
const rows: Row[] = [];
for (let i = 0; i < 300; i++) rows.push({ label: "row " + i, count: i * 1000 });
let piece = "x".repeat(1 << 16);
let head = "";
for (let bit = 16; bit < 31; bit++) {
  if (bit >= 22) head = head + piece;
  if (bit < 30) piece = piece + piece;
}
const left = 2 ** 31 - 1 - head.length;
const lengthOfRows = JSON.stringify(rows).length;
for (const past of [-1, 0, 1, 2, 40, 4097])
  console.log(past, tooLong(head, "f".repeat(left - lengthOfRows + past), rows, 1, past + 10));
console.log(sink.length, JSON.stringify(sink.slice(0, 3)));
