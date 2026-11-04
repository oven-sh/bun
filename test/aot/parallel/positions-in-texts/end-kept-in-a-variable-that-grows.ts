// the end is a variable, and one turn raises it
function codes(text: string): string {
  let end = text.length;
  let seen = "";
  for (let pos = 0; pos < end; pos++) {
    seen += text.charCodeAt(pos) + ",";
    if (pos === 1 && end === text.length) end += 2;
  }
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("a");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
