// `pos < text.length - 1`: the position and the one behind it lie inside
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length - 1; pos++) seen += text.charCodeAt(pos) + "," + text.charCodeAt(pos + 1) + "," + text.charCodeAt(pos + 2) + ";";
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("a") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
