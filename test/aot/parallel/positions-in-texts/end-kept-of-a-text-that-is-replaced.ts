// the end was read off the text that the variable held before
function codes(text: string, other: string): string {
  const end = text.length;
  text = other;
  let seen = "";
  for (let pos = 0; pos < end; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes("abcd", "ab") + "|" + codes("ab", "abcd");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
