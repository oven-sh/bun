// each turn adds to the text, and the test asks the new length
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length && pos < 8; pos++) {
    seen += text.charCodeAt(pos) + ",";
    if (pos % 2 === 0) text += "z";
  }
  return seen + text;
}
function deed(): string {
  return codes("ab") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
