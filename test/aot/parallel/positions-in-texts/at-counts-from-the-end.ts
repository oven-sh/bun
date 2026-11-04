// at() of a position that is below the length and below zero
function letters(text: string, from: number): string {
  let seen = "";
  for (let pos = from; pos < text.length; pos++) seen += text.at(pos) + ",";
  return seen;
}
function deed(): string {
  return letters("abc", -5) + "|" + letters("abc", 0) + "|" + letters("", -1);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
