// the outcome of the test is kept, and the position moves before it is asked
function codes(text: string): string {
  let seen = "";
  for (let from = 0; from < 5; from++) {
    let pos = from;
    const isInside = pos < text.length;
    pos += 2;
    if (isInside) seen += text.charCodeAt(pos) + ",";
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
