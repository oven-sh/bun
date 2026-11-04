// units above 255, and a text that is wide by one unit at its end
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes("\u4e2d\u6587") + "|" + codes("ab\u0100") + "|" + codes("\u00ff\u0100\uffff") + "|" + codes("ab");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
