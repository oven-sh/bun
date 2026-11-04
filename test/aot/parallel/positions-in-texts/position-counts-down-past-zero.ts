// the position counts down, below the length in every turn
function codes(text: string): string {
  let seen = "";
  for (let pos = text.length - 1; pos < text.length && pos > -3; pos--) seen += text.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
