// of two reads that come round one lies behind the end in the last turn
function last(text: string): string {
  let code = 0;
  let sum = 0;
  for (let pos = 0; pos < text.length; pos++) {
    code = pos % 2 ? text.charCodeAt(pos) : text.charCodeAt(pos + 1);
    sum += code;
  }
  return code + "," + sum;
}
function deed(): string {
  return last("abc") + "|" + last("abcd") + "|" + last("a");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
