// the read stands behind the `if`, not in it
function codes(text: string): string {
  let seen = "";
  let inside = 0;
  for (let pos = 0; pos < 7; pos++) {
    if (pos < text.length) inside++;
    seen += text.charCodeAt(pos) + ",";
  }
  return inside + ":" + seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
