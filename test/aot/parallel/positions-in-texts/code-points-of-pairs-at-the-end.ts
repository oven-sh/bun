// a pair, a lead surrogate as the last unit, a trail surrogate alone
function points(text: string): string {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.codePointAt(pos) + ",";
  return seen;
}
function deed(): string {
  return points("a\ud83d\ude00") + "|" + points("a\ud83d") + "|" + points("\ude00a") + "|" + points("\ud83d\ud83d\ude00") + "|" + points("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
