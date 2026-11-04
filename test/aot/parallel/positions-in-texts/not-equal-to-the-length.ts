// `!==` is passed by a step of two
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos !== text.length && seen.length < 40; pos += 2) seen += text.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes("abcd") + "|" + codes("abc");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
