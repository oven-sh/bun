// the read stands in the `else`
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    if (pos < text.length) seen += "inside,";
    else seen += text.charCodeAt(pos) + ",";
  }
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
