// `pos < text.length - -1` lets the end in
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length - -1; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
