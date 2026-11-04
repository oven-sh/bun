// the outcome that is asked is that of the turn before
function codes(text: string): string {
  let seen = "";
  let wasInside = true;
  for (let pos = 0; wasInside; pos++) {
    seen += text.charCodeAt(pos) + ",";
    wasInside = pos < text.length;
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
