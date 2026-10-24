const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function text(value: unknown, indent?: number | string): string {
  return JSON.stringify(leak(value), null, indent);
}
interface Texts { a: string; optional?: string; nullable: string | null; b: string }
const samples = ["", "x", "four", "seven77", "eight888", "fifteen-fifteen", "sixteen-sixteen-", "seventeen-sevente", "q\"uote", "back\\slash", "new\nline", "tab\t", "\u0000", "\u001f", " ", "\u007f", "café", "ÿ",
  "snow☃man", "😀", "\ud800", "\udc00x", "a".repeat(31), "a".repeat(32), "a".repeat(33), "a".repeat(63) + "\"", "b".repeat(64), "b".repeat(300), "c".repeat(300) + "\n", "d".repeat(9000), "☃".repeat(5000)];
for (const sample of samples) {
  const row: Texts = { a: sample, nullable: sample.length % 2 ? null : sample, b: sample + "!" };
  const full: Texts = { a: sample, optional: sample, nullable: sample, b: "end" };
  const one = text(row), two = text(full), many = text([row, row, full, row, full, full]);
  console.log(one.length, two.length, many.length, one.slice(0, 90), two.slice(-40), many.slice(-30));
}
function rope(count: number): string {
  let made = "";
  for (let i = 0; i < count; i++) made += String.fromCharCode(97 + (i % 26));
  return made;
}
console.log(text({ a: rope(5) + rope(40), nullable: null, b: rope(3) + "\"" + rope(3) } satisfies Texts));
const longKeys = { k: 1, twelveLetter: 2, thirteenChars: 3, fourteenLetter: 4, aKeyOfTwentyEightCharacters: 5, aKeyOfTwentyNineCharactersHi: 6, aKeyThatIsMuchLongerThanTwoBlocksOfSixteenBytesEach: "seven", last: true };
console.log(text(longKeys), text([longKeys, longKeys, longKeys]), text(longKeys, 1));
const oddKeys = { "with\"quote": 1, "with\\slash": 2, "with\nline": 3, "café": 4, "": 5, " ": 6, "0a": 7, end: 8 };
console.log(text(oddKeys), text([oddKeys, oddKeys]));
const wideKeys = { first: 1, "snow☃": 2, last: "z" };
console.log(text(wideKeys), text([wideKeys, wideKeys]), text({ before: "b", inner: wideKeys, after: "a" }));
const rows: Texts[] = [];
for (let i = 0; i < 400; i++) rows.push({ a: "row " + i, nullable: i % 3 ? "n" + i : null, b: "x".repeat(i % 70) });
const all = text(rows);
console.log(all.length, all.slice(0, 120), all.slice(-120), all === "[" + rows.map((row) => text(row)).join(",") + "]");
const growing: Texts[] = [];
for (let i = 0; i < 40; i++) growing.push({ a: "g".repeat(i * 211), nullable: null, b: "h".repeat(8191 - i) });
const grown = text(growing);
console.log(grown.length, grown === "[" + growing.map((row) => text(row)).join(",") + "]");
export {};
