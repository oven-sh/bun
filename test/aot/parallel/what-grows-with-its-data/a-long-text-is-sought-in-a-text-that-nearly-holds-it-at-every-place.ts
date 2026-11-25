// A text of one letter is searched, forwards and backwards, for half as many of that letter with another one at the end or in the middle: it nearly stands at every place, and what the search takes may not be the product of the two lengths. So too, both ways, in a text of two letters in turns for a piece of it with two neighbors turned round at its start, in its middle or at its end: it agrees far at every second place. Narrow and wide texts, by value and on proven texts.
// Sizes: 500 2000 8000
// Passes: 60
// Grows: linear
const size = Number(process.env.SIZE ?? 200),
  passes = Number(process.env.PASSES ?? 1);
function flat(text: string): string {
  return JSON.parse(JSON.stringify(text));
}
function last(text: any, part: any): number {
  return text.lastIndexOf(part);
}
function first(text: any, part: any): number {
  return text.indexOf(part);
}
function holds(text: any, part: any): boolean {
  return text.includes(part);
}
function lastInText(text: string, part: string): number {
  return ("" + text).lastIndexOf("" + part);
}
function firstInText(text: string, part: string): number {
  return ("" + text).indexOf("" + part);
}
function once(): string {
  let told = 0;
  for (const tail of ["c", "Ā"]) {
    const text = flat("a".repeat(size * 2) + tail);
    for (const part of [flat("a".repeat(size) + "b"), flat("b" + "a".repeat(size)), flat("a".repeat(size >> 1) + "b" + "a".repeat(size >> 1)), flat("a".repeat(size) + "ā")]) {
      told += last(text, part) + first(text, part) + (holds(text, part) ? 1 : 0) + lastInText(text, part) + firstInText(text, part);
    }
    told += last(text, flat("a".repeat(size) + tail)) + first(text, flat("a".repeat(size) + tail));
    const pairs = "ab".repeat(size);
    const ofPairs = flat(pairs + tail);
    for (const at of [0, (size >> 1) & ~1, size - 2]) {
      const turned = flat(pairs.slice(0, at) + pairs[at + 1] + pairs[at] + pairs.slice(at + 2, size));
      told += first(ofPairs, turned) + firstInText(ofPairs, turned) + (holds(ofPairs, turned) ? 1 : 0) + last(ofPairs, turned) + lastInText(ofPairs, turned);
    }
  }
  return String(told);
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
