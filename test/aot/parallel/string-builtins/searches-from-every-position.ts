// A character is sought forward and backward from every position of texts of every length around the strides of the searches, where it stands once, twice, or nowhere on the side that is searched.
function flat(text: string): string { return JSON.parse(JSON.stringify(text)) as string; }
function lastNaive(text: string, code: number, from: number): number { for (let i = Math.min(from, text.length - 1); i >= 0; i--) if (text.charCodeAt(i) === code) return i; return -1; }
function firstNaive(text: string, code: number, from: number): number { for (let i = Math.max(from, 0); i < text.length; i++) if (text.charCodeAt(i) === code) return i; return -1; }
const lastNarrow = (text: string, from: number): number => text.lastIndexOf("é", from);
const lastPlain = (text: string, from: number): number => text.lastIndexOf("z", from);
const lastWide = (text: string, from: number): number => text.lastIndexOf("日", from);
const firstNarrow = (text: string, from: number): number => text.indexOf("é", from);
const firstPlain = (text: string, from: number): number => text.indexOf("z", from);
const firstWide = (text: string, from: number): number => text.indexOf("日", from);
let wrong = 0, asked = 0, digest = 0;
function check(got: number, right: number, what: string): void { asked++; digest = (Math.imul(digest, 31) + got) | 0; if (got !== right && wrong++ < 5) console.log("wrong", what, got, right); }
for (const [mark, last, first] of [["é", lastNarrow, firstNarrow], ["z", lastPlain, firstPlain], ["日", lastWide, firstWide]] as const) {
  const code = mark.charCodeAt(0);
  for (const length of [0, 1, 7, 8, 9, 15, 16, 17, 18, 24, 31, 32, 33, 47, 48, 49, 64, 79, 140, 160]) {
    for (let at = 0; at < length; at += length > 50 ? 7 : 1) {
      for (const second of [-1, 0, at >> 1]) {
        let text = "x".repeat(at) + mark + "x".repeat(length - at - 1);
        if (second >= 0 && second < at) text = text.slice(0, second) + mark + text.slice(second + 1);
        text = flat(text);
        for (let from = -1; from < length + 2; from += length > 50 ? 3 : 1) {
          check(last(text, from), from < 0 ? lastNaive(text, code, 0) : lastNaive(text, code, from), mark + " last " + length + " " + at + " " + from);
          check(first(text, from), firstNaive(text, code, from), mark + " first " + length + " " + at + " " + from);
          const piece = text.slice(2, -1);
          check(piece.lastIndexOf(mark, from), from < 0 ? lastNaive(piece, code, 0) : lastNaive(piece, code, from), mark + " piece " + length + " " + at + " " + from);
          check(piece.indexOf(mark, from), firstNaive(piece, code, from), mark + " piece first " + length + " " + at + " " + from);
        }
      }
    }
  }
}
// What stands in the registers of a search's arguments is asked again behind it.
let sums = 0;
for (let i = 0; i < 3000; i++) {
  const text = "x".repeat(40) + (i & 1 ? "é" : "z") + "y".repeat(i & 31);
  const from = i % 60;
  const one = text.lastIndexOf("é", from), two = text.lastIndexOf("z", from), three = text.indexOf("é", from), four = text.indexOf("z", from);
  sums = (sums + one * 3 + two * 5 + three * 7 + four * 11 + from + text.length * 13) | 0;
}
console.log(asked, wrong, digest, sums);
