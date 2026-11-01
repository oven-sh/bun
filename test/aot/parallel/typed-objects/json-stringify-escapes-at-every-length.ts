// JSON.stringify of strings that have something to escape, at every length up to a few vectors and at every place: alone, and as a member of an object that was parsed by a type that lists fewer members than the source has.
const special = ['"', "\\", "\n", "\t", "\b", "\f", "\r", "\u0000", "\u001f", "\u007f", "/", "é", " "];
let sum = 0;
const mix = (text: string) => {
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
};
const quote = (text: string): string => JSON.stringify(text);
interface Row { label: string }
const writeRow = (row: Row): string => JSON.stringify(row);
const writeRows = (rows: Row[]): string => JSON.stringify(rows);

let samples = 0;
for (let length = 0; length <= 70; length++) {
  for (const character of special) {
    for (const at of new Set([0, 1, length >> 1, length - 2, length - 1])) {
      if (at < 0 || at >= length) continue;
      const text = "abcdefghij".repeat(7).slice(0, at) + character + "klmnopqrst".repeat(7).slice(0, length - at - 1);
      const quoted = quote(text);
      mix(quoted);
      if (JSON.parse(quoted) !== text) console.log("does not come back", length, at, JSON.stringify(character));
      const source = '{"id":' + length + ',"label":' + quoted + ',"ok":true,"note":' + quoted + "}";
      const row = JSON.parse(source) as Row;
      const written = writeRow(row);
      mix(written);
      if (written !== source) console.log("another text", length, at, written, source);
      if (samples++ % 397 === 0) console.log(quoted, written);
    }
  }
}
// Everything is escaped: the text is six times as long as the string.
for (const length of [1, 7, 8, 15, 16, 17, 40, 200, 3000]) {
  const text = "\u0001".repeat(length);
  const rows = JSON.parse("[" + [1, 2, 3].map(id => '{"id":' + id + ',"label":' + quote(text) + ',"tail":"\\n"}').join(",") + "]") as Row[];
  const written = writeRows(rows);
  mix(written);
  console.log(length, quote(text).length, written.length, rows[2]!.label.length);
}
console.log(sum);
