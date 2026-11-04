// the position is -0
function code(text: string, pos: number): string {
  if (pos < text.length) return String(text.charCodeAt(pos)) + "," + String(1 / pos);
  return "outside " + String(1 / pos);
}
function deed(): string {
  return code("abc", -0) + "|" + code("", -0) + "|" + code("abc", 0);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
