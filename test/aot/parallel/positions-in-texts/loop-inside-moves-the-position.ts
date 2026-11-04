// a loop inside runs the position to the end, and the read behind it has no test
function codes(text: string): string {
  let seen = "";
  let pos = 0;
  while (pos < text.length) {
    while (text.charCodeAt(pos) === 32) pos++;
    seen += text.charCodeAt(pos) + ",";
    pos++;
  }
  return seen;
}
function deed(): string {
  return codes("a b") + "|" + codes("ab  ") + "|" + codes(" ");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
