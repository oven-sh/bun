// the char code is carried from turn to turn
function last(text: string): string {
  let code = -1;
  let sum = 0;
  for (let pos = 0; pos < text.length; pos++) {
    sum += code;
    code = text.charCodeAt(pos);
  }
  return code + "," + sum;
}
function deed(): string {
  return last("abc") + "|" + last("") + "|" + last("\uffff\uffff");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
