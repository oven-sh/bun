// texts in members and in names: quotes, backslashes, control characters, U+2028, lone and paired surrogates, Latin-1 and 16 bits, a rope, a long text, the empty text
type Row = { text: string; "a\"b\\c": string; "Āwide": string; "line\nbreak": string };
function write(row: Row): string {
  return JSON.stringify(row);
}
function make(text: string): Row {
  return { text, 'a"b\\c': text, "Āwide": text, "line\nbreak": text };
}
function show(text: string) {
  let codes = "";
  for (let i = 0; i < text.length && i < 200; i++) codes += text.charCodeAt(i).toString(16) + " ";
  console.log(text.length, codes);
}
const texts = ["", "plain", 'q"q', "b\\b", "\n\t\r\b\f\u0000\u001f", "  ", "\ud800", "\udc00x", "😀", "éÿ", "Ā中", "\u007f"];
for (let i = 0; i < texts.length; i++) show(write(make(texts[i])));
let rope = "";
for (let i = 0; i < 40; i++) rope += i + '"';
show(write(make(rope)));
console.log(write(make("z".repeat(70000))).length);
console.log(write(make("Ā".repeat(70000))).length);
