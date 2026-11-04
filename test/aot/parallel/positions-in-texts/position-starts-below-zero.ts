// the position starts below zero, and is below the length all the same
function codes(text: string, from: number): string {
  let seen = "";
  for (let pos = from; pos < text.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes("abc", -2) + "|" + codes("abc", 1) + "|" + codes("", -1);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
