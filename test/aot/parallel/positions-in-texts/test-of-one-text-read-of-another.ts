// the length is that of another text
function codes(first: string, second: string): string {
  let seen = "";
  for (let pos = 0; pos < first.length; pos++) seen += second.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes("abcdef", "ab") + "|" + codes("ab", "abcdef") + "|" + codes("abc", "");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
