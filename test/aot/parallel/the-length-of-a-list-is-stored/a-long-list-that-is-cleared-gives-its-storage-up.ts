// A long list gives its storage up when it is cleared or cut: fourteen of the sixteen lists of each kind, see https://github.com/oven-sh/bun/pull/49591.
const { heapStats } = require("bun:jsc");
function held(): number { Bun.gc(true); Bun.gc(true); const stats = heapStats(); return stats.heapSize + stats.extraMemorySize; }
function clear(list: unknown[]): void { list.length = 0; }
function cut(list: unknown[], to: number): void { list.length = to >>> 0; }
function total(lists: unknown[][]): number { let sum = 0; for (const list of lists) sum += list.length; return sum; }
const whole: number[][] = [], fractions: number[][] = [], texts: string[][] = [];
// In a call: in the module's own frame this loop leaves a pointer into the last list in a slot that nothing writes again.
function fill(): void {
  for (let n = 0; n < 16; n++) { whole.push([]); fractions.push([]); texts.push([]); }
  for (let i = 0; i < 125000; i++) for (let n = 0; n < 16; n++) { whole[n]!.push(i); fractions[n]!.push(i + 0.5); texts[n]!.push("t"); }
}
// A list of 125,000 items holds 1,046,000 bytes: fourteen hold 14,600,000 and thirteen 13,600,000.
function givenUp(before: number, after: number): boolean { return before - after > 14000000; }
fill();
const full = held();
for (const list of whole) clear(list);
const withoutWhole = held();
for (const list of fractions) cut(list, 3);
const withoutFractions = held();
for (const list of texts) clear(list);
const withoutTexts = held();
console.log(total(whole), total(fractions), fractions[15]![2], 3 in fractions[15]!, total(texts));
console.log("given up:", givenUp(full, withoutWhole), givenUp(withoutWhole, withoutFractions), givenUp(withoutFractions, withoutTexts));
for (let i = 0; i < 100; i++) { whole[0]!.push(i); fractions[0]!.push(i + 0.5); texts[0]!.push("u"); }
console.log(whole[0]!.length, whole[0]![99], fractions[0]!.length, fractions[0]![3], texts[0]!.length, texts[0]![0]);
