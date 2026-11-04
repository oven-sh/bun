// the code point is carried from turn to turn, and decides the step
function points(text: string): string {
  let point = 0;
  let seen = "";
  for (let pos = 0; pos < text.length; pos += point > 0xffff ? 2 : 1) {
    point = text.codePointAt(pos)!;
    seen += point + ",";
  }
  return seen + point;
}
function deed(): string {
  return points("a\ud83d\ude00b") + "|" + points("\ud83d") + "|" + points("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
