// the text loses its last character between two reads of one turn
function codes(text: string): string {
  let seen = "";
  let pos = 0;
  while (pos < text.length) {
    seen += text.charCodeAt(pos) + ",";
    text = text.slice(0, text.length - 2);
    seen += text.charCodeAt(pos) + ";";
    pos++;
  }
  return seen;
}
function deed(): string {
  return codes("abcdef") + "|" + codes("a");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
