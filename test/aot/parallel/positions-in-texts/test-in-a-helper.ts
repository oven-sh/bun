// the test stands in a function of its own
function isInside(text: string, pos: number): boolean {
  return pos < text.length;
}
function codes(text: string, other: string): string {
  let seen = "";
  for (let pos = 0; isInside(text, pos); pos++) seen += text.charCodeAt(pos) + "," + other.charCodeAt(pos) + ";";
  return seen;
}
function deed(): string {
  return codes("abc", "a") + "|" + codes("", "a");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
