// A long list gives its storage up when its length is set to nought or to three: whole numbers, fractions and texts, each kind by itself.
// The collector takes any word of the stack that lies inside a buffer for a pointer to it, so what a call left there can keep the storage
// of a list that nothing holds. So each kind has sixteen lists, and one or two whose storage stays count as none.
// The lists are filled and cleared in calls of their own: a loop in this frame leaves a pointer into the last list that it touched,
// and the calls that follow keep it on the stack.
const { heapStats } = require("bun:jsc");
function held(): number { Bun.gc(true); Bun.gc(true); const stats = heapStats(); return stats.heapSize + stats.extraMemorySize; }
function clear(list: unknown[]): void { list.length = 0; }
function cut(list: unknown[], to: number): void { list.length = to >>> 0; }
function total(lists: unknown[][]): number { let sum = 0; for (const list of lists) sum += list.length; return sum; }
const whole: number[][] = [], fractions: number[][] = [], texts: string[][] = [];
function fill(): void {
  for (let n = 0; n < 16; n++) { whole.push([]); fractions.push([]); texts.push([]); }
  for (let i = 0; i < 125000; i++) for (let n = 0; n < 16; n++) { whole[n]!.push(i); fractions[n]!.push(i + 0.5); texts[n]!.push("t"); }
}
function clearAll(lists: unknown[][]): void { for (const list of lists) clear(list); }
function cutAll(lists: unknown[][], to: number): void { for (const list of lists) cut(list, to); }
// A list of 125,000 items holds 1,046,000 bytes: sixteen hold 16,700,000, fourteen 14,600,000 and thirteen 13,600,000.
function givenUp(before: number, after: number): boolean { return before - after > 14000000; }
fill();
const full = held();
clearAll(whole);
const withoutWhole = held();
cutAll(fractions, 3);
const withoutFractions = held();
clearAll(texts);
const withoutTexts = held();
console.log(total(whole), total(fractions), fractions[15]![2], 3 in fractions[15]!, total(texts));
console.log("given up:", givenUp(full, withoutWhole), givenUp(withoutWhole, withoutFractions), givenUp(withoutFractions, withoutTexts));
for (let i = 0; i < 100; i++) { whole[0]!.push(i); fractions[0]!.push(i + 0.5); texts[0]!.push("u"); }
console.log(whole[0]!.length, whole[0]![99], fractions[0]!.length, fractions[0]![3], texts[0]!.length, texts[0]![0]);
