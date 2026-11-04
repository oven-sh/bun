// `if (pos > end) break` lets the end in
function codes(text: string): string {
  const end = text.length;
  let seen = "";
  let pos = 0;
  while (true) {
    if (pos > end) break;
    seen += text.charCodeAt(pos) + ",";
    pos++;
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
