// the same, and the text that is read is the one that is named first
function codes(first: string, second: string): string {
  let seen = "";
  for (let pos = 0; pos < second.length; pos++) seen += first.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes("ab", "abcdef") + "|" + codes("abcdef", "ab") + "|" + codes("", "abc");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
