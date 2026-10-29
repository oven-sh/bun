// codePointAt, a loop over a string and a pattern that takes a string apart read code points: of narrow and wide texts, pairs and halves of pairs, ropes and pieces of other strings, at positions in and out of range.
function at(text: string, position: number): number | undefined {
  return text.codePointAt(position);
}
function first(text: any): number | undefined {
  return text.codePointAt();
}
function inRange(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.codePointAt(i)!;
  return sum;
}
function walk(value: any): string {
  const parts: string[] = [];
  for (const part of value) parts.push(String(part.codePointAt ? part.codePointAt(0) : part));
  return parts.join(",");
}
function takeApart(value: any): string {
  const [a, b, ...rest] = value;
  return `${a}|${b}|${rest.length}`;
}
function spread(value: any): number {
  return [...value].length;
}

const narrow = "plain text";
const wide = "wide 世界 text";
const pairs = "a\u{1f600}b\u{10ffff}\u{10000}";
const halves = "\ud83d" + "x" + "\ude00" + "\ud83d";
const leadAtEnd = "ab\ud800";
const twoLeads = "\ud800𐀀";
function rope(a: string, b: string): string {
  return a + b;
}
const texts = [
  "",
  "x",
  narrow,
  wide,
  pairs,
  halves,
  leadAtEnd,
  twoLeads,
  rope(narrow, narrow),
  rope(narrow, pairs),
  rope(rope(wide, "-"), rope(pairs, halves)),
  rope("\ud83d", "\ude00"),
  (narrow + wide + pairs).slice(3, 24),
  (narrow + narrow + narrow).substring(5, 27),
  pairs.slice(2),
];
const positions = [0, 1, 2, 3, 5, 9, 10, 21, 1000, -1, -0, 0.5, 1.9, -0.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 1, -(2 ** 31), 2 ** 53];

for (const text of texts) {
  console.log(JSON.stringify(text.length), first(text), inRange(text), positions.map(position => String(at(text, position))).join(" "));
  console.log(walk(text), takeApart(text), spread(text));
}
console.log(walk([1, "two", "\u{1f600}"]), takeApart([1, 2, 3, 4]), spread(new Set(["a", "b"])), walk(new Set(["世"])), takeApart(new Map([[1, 2]]).keys()));
