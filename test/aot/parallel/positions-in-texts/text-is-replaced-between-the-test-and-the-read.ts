// the variable holds a shorter text at the read than at the test
function codes(text: string, other: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    let read = text;
    if (pos < read.length) {
      read = other;
      seen += read.charCodeAt(pos) + ",";
    }
  }
  return seen;
}
function deed(): string {
  return codes("abcdef", "ab") + "|" + codes("ab", "abcdef");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
