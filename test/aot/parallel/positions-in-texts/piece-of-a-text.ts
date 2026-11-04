// the text is a slice, and the position is below the length of the slice or of the whole
function codes(whole: string, from: number, to: number): string {
  const piece = whole.slice(from, to);
  let seen = "";
  for (let pos = 0; pos < piece.length; pos++) seen += piece.charCodeAt(pos) + ",";
  for (let pos = 0; pos < whole.length; pos++) seen += piece.charCodeAt(pos) + ";";
  return seen;
}
function deed(): string {
  return codes("abcdef", 2, 4) + "|" + codes("abcdef", 4, 2) + "|" + codes("abcdef", 5, 99);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
