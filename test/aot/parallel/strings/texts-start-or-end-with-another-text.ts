// Texts that start or end with another text.
const hidden = new Function("v", "return v") as <V>(v: V) => V;

function starts(text: string, other: string): boolean { return text.startsWith(other); }
function ends(text: string, other: string): boolean { return text.endsWith(other); }
function startsAt(text: string, other: string, position: number): boolean { return text.startsWith(other, position); }
function endsAt(text: string, other: string, end: number): boolean { return text.endsWith(other, end); }
function between(text: string, head: string, tail: string): string | undefined {
  return text.length >= head.length + tail.length && text.startsWith(head) && text.endsWith(tail) ? text.slice(head.length, text.length - tail.length) : undefined;
}

const plain = ["", "a", "ab", "abc", "abcdefgh", "abcdefghi", "abcdefghijklmnopqrstuvwxyz0123456789", "prefix-middle-suffix", "prefix", "suffix", "-", "été", "日本語のテキスト", "日本", "テキスト", "x".repeat(200), "x".repeat(199) + "y"];
const texts: string[] = [];
for (const text of plain) {
  texts.push(text);
  texts.push(hidden(text.split("").join("")));
  texts.push(hidden(hidden(text.slice(0, 2)) + hidden(text.slice(2))));
  texts.push(hidden(("<<" + text + ">>").split("").join("")).slice(2, -2));
  texts.push(hidden(("日" + text).split("").join("")).slice(1));
}
const positions = [0, 1, 2, 7, 8, 9, 199, 200, 201, -1, -0, 0.5, 1.9, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 1, -(2 ** 31) - 1];

let digest = 0;
const rounds = Number(process.argv[2] ?? 2);
for (let round = 0; round < rounds; round++) {
  for (const text of texts) {
    for (const other of texts) {
      digest = (digest * 31 + (starts(text, other) ? 1 : 0) + (ends(text, other) ? 2 : 0)) | 0;
      const middle = between(text, other, other);
      if (middle !== undefined) digest = (digest * 31 + middle.length) | 0;
    }
  }
}
for (const text of texts) {
  for (const other of ["", "a", "b", "abc", "x", "y", "本", hidden("x".repeat(100))]) {
    for (const position of positions) digest = (digest * 31 + (startsAt(text, other, position) ? 1 : 0) + (endsAt(text, other, position) ? 2 : 0)) | 0;
  }
}
// A module's top level runs once: there a call has its short form.
const t = hidden("prefix-middle-suffix".split("").join("")), p = hidden("prefix".split("").join("")), s = hidden("suffix".split("").join(""));
console.log(digest, t.startsWith(p), t.startsWith(s), t.endsWith(s), t.endsWith(p), t.startsWith(p, 1), t.startsWith(s, 14), t.endsWith(p, 6), t.endsWith(p, 5), t.startsWith("", 99), t.endsWith("", -5), p.startsWith(t), between(t, p, s));
