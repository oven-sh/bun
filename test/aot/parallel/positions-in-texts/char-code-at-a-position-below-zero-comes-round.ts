// the char code is carried from turn to turn, and the first positions lie below zero
function last(text: string, from: number): string {
  let code = 7;
  let sum = 0;
  for (let pos = from; pos < text.length; pos++) {
    sum += code;
    code = text.charCodeAt(pos);
  }
  return code + "," + sum;
}
function deed(): string {
  return last("abc", -2) + "|" + last("", -1) + "|" + last("abc", 0);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
