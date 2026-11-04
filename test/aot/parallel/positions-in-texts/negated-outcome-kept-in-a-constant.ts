// `const isOutside = !(pos < text.length)` is what is asked
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    const isOutside = !(pos < text.length);
    if (isOutside) seen += "outside " + text.charCodeAt(pos) + ",";
    else seen += "inside " + text.charCodeAt(pos) + ",";
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
