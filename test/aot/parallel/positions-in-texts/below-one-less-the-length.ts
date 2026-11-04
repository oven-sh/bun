// `pos < 9 - text.length`: the length is what is taken away
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 9 - text.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("abcdefgh");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
