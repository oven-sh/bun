// `++pos` stands in the read
function codes(text: string): string {
  let seen = "";
  let pos = -1;
  while (pos < text.length) seen += text.charCodeAt(++pos) + ",";
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
