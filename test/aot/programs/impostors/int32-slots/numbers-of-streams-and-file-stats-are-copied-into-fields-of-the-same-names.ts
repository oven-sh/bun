// The program's own class has number fields called pos, end, start and size, and so have Bun's read streams and file stats. An interface with those names fits both.
// Real streams and stats go through the functions typed by the interface, and their numbers are copied into the program's objects: `end` of a stream is Infinity, `pos` is undefined, times are fractions.
// Plain objects parsed at run time stand in for a file of more than 2 ** 31 bytes.
import { closeSync, createReadStream, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
interface TextRange { pos: number; end: number }
interface Sized { size: number }
class Span implements TextRange {
  pos = 0;
  end = 0;
  constructor(pos: number, end: number) {
    this.pos = pos;
    this.end = end;
    handOver(this);
  }
}
class Entry implements Sized {
  size = 0;
  start = 0;
  modified = 0;
}
function width(range: TextRange) {
  return range.end - range.pos;
}
function copyRange(target: Span, range: TextRange) {
  target.pos = range.pos;
  target.end = range.end;
}
function copySize(target: Entry, sized: Sized) {
  target.size = sized.size;
}
function total(list: Sized[]) {
  let sum = 0;
  for (const item of list) sum += item.size;
  return sum;
}
function showSpan(span: Span) {
  return `${exact(span.pos)} ${exact(span.end)} ${exact(width(span))} ${JSON.stringify(span)} [${Object.keys(span)}]`;
}
function showEntry(entry: Entry) {
  return `${exact(entry.size)} ${exact(entry.start)} ${Number.isInteger(entry.modified)} ${exact(entry.size + 1)} [${Object.keys(entry)}]`;
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const a = new Span(i & 15, (i & 15) + 4), b = new Span(0, 0), e = new Entry(), f = new Entry();
  handOver(e);
  copyRange(b, a);
  e.size = i & 255;
  e.start = i & 3;
  copySize(f, e);
  sum += width(b) + total([e, f]);
}
console.log("warm", sum);

const folder = mkdtempSync(join(tmpdir(), "int32-slots-"));
const file = join(folder, "data.txt");
writeFileSync(file, "0123456789");
const whole = createReadStream(file);
const part = createReadStream(file, { start: 2, end: 5 });
for (const [label, stream] of [["a whole file", whole], ["a part", part]] as [string, unknown][]) {
  const span = new Span(1, 2);
  copyRange(span, stream as TextRange);
  console.log(label + ":", showSpan(span), exact(width(stream as TextRange)));
  copyRange(span, new Span(3, 9));
  console.log("  and an ordinary range again:", showSpan(span));
}
// The folder is gone before either stream has opened its file: that error is not what is asked about here.
whole.on("error", () => {}).destroy();
part.on("error", () => {}).destroy();
const stats = statSync(file);
const entry = new Entry();
copySize(entry, stats);
entry.modified = stats.mtimeMs + 0.5;
entry.start = stats.size - 10.5;
console.log("stats:", showEntry(entry), total([stats, entry]));
const descriptor = openSync(file, "r");
closeSync(descriptor);
rmSync(folder, { recursive: true });
for (const fake of JSON.parse('[{"size":2147483648},{"size":4294967301},{"size":0.5},{"size":-2147483648},{"size":-2147483645},{"size":null},{}]'.split("").join("")) as Sized[]) {
  const target = new Entry();
  copySize(target, fake);
  console.log("a stand-in", JSON.stringify(fake) + ":", showEntry(target), exact(total([fake, target])));
}
for (const fake of JSON.parse('[{"pos":0.5,"end":2147483648},{"pos":-2147483648,"end":-2147483644},{"pos":1e21,"end":5e-324}]'.split("").join("")) as TextRange[]) {
  const span = new Span(0, 0);
  copyRange(span, fake);
  console.log("a stand-in", JSON.stringify(fake) + ":", showSpan(span));
}
