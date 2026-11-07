// A pattern that is one class of characters finds the first such character from wherever it is asked to begin, in subjects of every length, with the character at every place.
// Alone: TODO: with it among the entry points the executable is not built at the first try
type Row = { pattern: RegExp; all: RegExp; holds: (code: number) => boolean };
const inText = (text: string) => (code: number) => text.includes(String.fromCharCode(code));
const rows: Row[] = [
  { pattern: /["'&<>]/, all: /["'&<>]/g, holds: inText("\"'&<>") },
  { pattern: /[*?]/, all: /[*?]/g, holds: inText("*?") },
  { pattern: /\d/, all: /\d/g, holds: code => code >= 48 && code <= 57 },
  { pattern: /[A-Z]/, all: /[A-Z]/g, holds: code => code >= 65 && code <= 90 },
  { pattern: /[a-z_]/, all: /[a-z_]/g, holds: code => (code >= 97 && code <= 122) || code === 95 },
  { pattern: /[0-9A-Fa-f]/, all: /[0-9A-Fa-f]/g, holds: code => (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102) },
  { pattern: /\w/, all: /\w/g, holds: code => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 },
  { pattern: /[\x00-\x1f<\x7f]/, all: /[\x00-\x1f<\x7f]/g, holds: code => code <= 31 || code === 60 || code === 127 },
  { pattern: /[^\t\x20-\x7e\x80-\xff]/, all: /[^\t\x20-\x7e\x80-\xff]/g, holds: code => code > 255 || (code !== 9 && (code < 32 || code === 127)) },
  { pattern: /[^\x20-\x7e]/, all: /[^\x20-\x7e]/g, holds: code => code < 32 || code > 126 },
  { pattern: /[^a-z]/, all: /[^a-z]/g, holds: code => code < 97 || code > 122 },
  { pattern: /[^ ]/, all: /[^ ]/g, holds: code => code !== 32 },
  { pattern: /\W/, all: /\W/g, holds: code => !((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95) },
  { pattern: /\D/, all: /\D/g, holds: code => code < 48 || code > 57 },
  { pattern: /[\x80-\xff]/, all: /[\x80-\xff]/g, holds: code => code >= 128 && code <= 255 },
  { pattern: /[^\x00-\x7f]/, all: /[^\x00-\x7f]/g, holds: code => code > 127 },
  { pattern: /[\xe0-\xef]/, all: /[\xe0-\xef]/g, holds: code => code >= 0xe0 && code <= 0xef },
  { pattern: /[a\xe9]/, all: /[a\xe9]/g, holds: code => code === 97 || code === 0xe9 },
  { pattern: /\s/, all: /\s/g, holds: code => (code >= 9 && code <= 13) || code === 32 || code === 160 || code === 0x2028 },
  { pattern: /[k]/i, all: /[k]/gi, holds: code => code === 75 || code === 107 },
  { pattern: /[q-s]/i, all: /[q-s]/gi, holds: code => (code >= 81 && code <= 83) || (code >= 113 && code <= 115) },
  { pattern: /[@\x00]/, all: /[@\x00]/g, holds: code => code === 64 || code === 0 },
  { pattern: /[?\x7f]/u, all: /[?\x7f]/gu, holds: code => code === 63 || code === 127 },
];
const fillers = ["a", " ", "Z", "5", "\x01", "\xa0", "\xfc", "\x7f", "~", "@", "?", "\x80"];
const marks = ['"', "<", "*", "7", "Q", "_", "f", "\x03", "\x7f", "\t", " ", "a", "\x80", "\xe3", "\xe9", "\xff", "\xa0", "k", "S", "@", "\x00", "?", "\xbf", "\xc0"];
let checked = 0;
const wrong: string[] = [];
function first(subject: string, holds: (code: number) => boolean, from: number) {
  for (let at = from; at < subject.length; at++) if (holds(subject.charCodeAt(at))) return at;
  return -1;
}
function check(row: Row, subject: string) {
  const expected = first(subject, row.holds, 0);
  const found = row.pattern.exec(subject);
  checked++;
  if ((found ? found.index : -1) !== expected || (found !== null && (found[0] !== subject[expected] || found.length !== 1)) || row.pattern.test(subject) !== expected >= 0 || subject.search(row.pattern) !== expected)
    wrong.push(`${row.pattern} ${JSON.stringify(subject)}: ${found ? found.index : -1} for ${expected}`);
  const from = (subject.length * 7 + checked) % (subject.length + 1);
  row.all.lastIndex = from;
  const later = row.all.exec(subject);
  const expectedLater = first(subject, row.holds, from);
  if ((later ? later.index : -1) !== expectedLater || row.all.lastIndex !== (expectedLater < 0 ? 0 : expectedLater + 1)) wrong.push(`${row.all} ${JSON.stringify(subject)} from ${from}: ${later ? later.index : -1} for ${expectedLater}, lastIndex ${row.all.lastIndex}`);
}
for (const row of rows) {
  for (const filler of fillers) {
    for (let length = 0; length <= 84; length += length < 40 ? 1 : 11) {
      const plain = filler.repeat(length);
      check(row, plain);
      for (let at = 0; at < length; at += at < 36 || at > length - 19 ? 1 : 5) {
        for (const mark of marks) {
          if (!row.holds(mark.charCodeAt(0)) && (at + length) % 5) continue;
          check(row, plain.slice(0, at) + mark + plain.slice(at + 1));
        }
      }
    }
  }
}
console.log(checked, wrong.length, wrong.slice(0, 8).join("\n"));

const text = ("The <b>quick</b> brown fox & the \"lazy\" dog's tail; 12 of 345 \xe9t\xe9s\t".repeat(5) + "plain words without any of them on and on and on for a while longer than a block or two").repeat(2);
for (const row of rows) {
  const places: number[] = [];
  for (const match of text.matchAll(row.all)) places.push(match.index);
  console.log(String(row.all), places.length, places.slice(0, 5).join(), places.slice(-3).join(), text.replace(row.all, "").length, text.split(row.pattern).length, text.replace(row.pattern, "[$&]").slice(0, 12), (text + "\u4e2d").search(row.pattern), ("\u4e2d" + text).replace(row.all, "").length);
}
console.log(RegExp.lastMatch.length, /["'&<>]/.exec("a<b")!.input, RegExp.leftContext, RegExp.rightContext, /[*?]/y.test("a*"), /[*?]/y.test("*a"), /([*?])/.exec("a?")![1]);
