// `continue` of the loop around comes to the read of the next turn by the step alone
function codes(text: string): string {
  let seen = "";
  let pos = 0;
  outer: for (let turn = 0; turn < 6; turn++) {
    seen += text.charCodeAt(pos) + ",";
    while (pos < text.length) {
      pos += 2;
      continue outer;
    }
  }
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
