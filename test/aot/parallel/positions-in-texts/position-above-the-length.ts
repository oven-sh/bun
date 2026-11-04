// `pos > text.length` has passed, and has failed
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    if (pos > text.length) seen += "above " + text.charCodeAt(pos) + ",";
    else seen += "not above " + text.charCodeAt(pos) + ",";
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
