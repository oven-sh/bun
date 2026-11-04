// `text[pos]`, charAt and at, inside and one behind
function letters(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text[pos] + text.charAt(pos) + text.at(pos) + "," + text[pos + 1] + text.charAt(pos + 1) + text.at(pos + 1) + ";";
  return seen;
}
function deed(): string {
  return letters("abc") + "|" + letters("") + "|" + letters("\u4e2da");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
