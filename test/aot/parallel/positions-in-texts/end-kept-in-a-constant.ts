// `const end = text.length`
function codes(text: string): string {
  const end = text.length;
  let seen = "";
  for (let pos = 0; pos < end; pos++) seen += text.charCodeAt(pos) + "," + text.codePointAt(pos) + ";";
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
