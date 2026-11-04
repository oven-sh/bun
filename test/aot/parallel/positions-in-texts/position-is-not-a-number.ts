// the position is NaN, which is not at or behind the end
function code(text: string, pos: number): string {
  if (!(pos >= text.length)) return String(text.charCodeAt(pos)) + "," + String(text.codePointAt(pos));
  return "outside";
}
function deed(): string {
  return code("abc", NaN) + "|" + code("", NaN) + "|" + code("abc", 1) + "|" + code("abc", 3);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
