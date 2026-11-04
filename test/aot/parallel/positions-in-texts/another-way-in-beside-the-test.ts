// `pos < text.length || force`
function codes(text: string, force: boolean): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    if (pos < text.length || force) seen += text.charCodeAt(pos) + ",";
  }
  return seen;
}
function deed(): string {
  return codes("abc", true) + "|" + codes("abc", false) + "|" + codes("", true);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
