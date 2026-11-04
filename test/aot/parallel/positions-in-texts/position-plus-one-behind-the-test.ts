// the read is one behind the position that was tested
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.charCodeAt(pos + 1) + "," + text.codePointAt(pos + 1) + ";";
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("a");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
