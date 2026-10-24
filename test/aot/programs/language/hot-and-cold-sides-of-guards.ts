// Each of these goes the usual way often and the unusual way too: a Map with string keys and one with number keys, iterated and cleared; values that fit four bytes and values that do not; text with and without surrogate pairs; strict equality of equal and of unequal values; concatenation that stays short and that becomes a rope; an array literal that keeps its kind of elements and one that does not.
function sumOfMap<K>(map: Map<K, number>): number {
  let sum = 0;
  for (const [, value] of map) sum += value;
  for (const value of map.values()) sum += value;
  let keys = 0;
  for (const key of map.keys()) keys += String(key).length;
  return sum + keys;
}
const byName = new Map<string, number>();
const byNumber = new Map<number, number>();
const halves = new Map<string, number>();
for (let i = 0; i < 40; i++) {
  byName.set("k" + i, i);
  byNumber.set(i * 3, i);
  halves.set("h" + i, i + 0.5);
}
console.log(sumOfMap(byName), sumOfMap(byNumber), sumOfMap(halves));
const objects = new Map<string, { n: number }>();
for (let i = 0; i < 10; i++) objects.set("o" + i, { n: i });
let n = 0;
for (const value of objects.values()) n += value.n;
console.log(n);
const empty = new Map<string, number>();
empty.clear();
byName.clear();
byNumber.clear();
console.log(empty.size, byName.size, byNumber.size, sumOfMap(byName));

function codePoints(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.codePointAt(i)!;
  return sum;
}
console.log(codePoints("plain text"), codePoints("wide 中文"), codePoints("pairs \u{1F600}\u{1F601}"), codePoints("lone \ud83d"));

function same(a: unknown, b: unknown): boolean {
  return a === b;
}
function sameNumber(a: number, b: unknown): boolean {
  return a === b;
}
const one = { id: 1 };
const pairs: [unknown, unknown][] = [[1, 1], [1, 2], [1.5, 1.5], [NaN, NaN], ["a", "a"], ["a", "b"], [one, one], [one, { id: 1 }], [null, undefined], [undefined, undefined], [0, -0], [true, true], [true, 1]];
console.log(pairs.map(([a, b]) => (same(a, b) ? "y" : "n")).join(""));
console.log([1, 2, 1.0, "1", null, 1.5].map(b => (sameNumber(1, b) ? "y" : "n")).join(""));
let equal = 0;
for (let i = 0; i < 2000; i++) if (same(i % 50, 7)) equal++;
for (let i = 0; i < 2000; i++) if (same(7, 7)) equal++;
console.log(equal);

function label(prefix: string, i: number, suffix: string): string {
  return prefix + i + ":" + suffix;
}
let lengths = 0;
for (let i = 0; i < 200; i++) lengths += label("p", i, "s").length;
lengths += label("x".repeat(300), 1, "y".repeat(300)).length;
console.log(lengths);

function literal(a: number, b: number): number[] {
  return [a, b, a + b];
}
console.log(literal(1, 2).join(), literal(1.5, 2).join(), literal(1, 2.25).join());
