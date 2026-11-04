// the position goes by halves
function codes(text: string, from: number): string {
  let seen = "";
  for (let pos = from; pos < text.length; pos += 0.5) seen += text.charCodeAt(pos) + "," + text.codePointAt(pos) + ";";
  return seen;
}
function deed(): string {
  return codes("abc", 0) + "|" + codes("abc", -0.75) + "|" + codes("abc", 2.5) + "|" + codes("", -0.75);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
