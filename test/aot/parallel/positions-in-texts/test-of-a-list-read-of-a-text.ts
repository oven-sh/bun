// the length is that of a list
function codes(list: number[], text: string): string {
  let seen = "";
  for (let pos = 0; pos < list.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes([1, 2, 3, 4, 5], "ab") + "|" + codes([1], "ab") + "|" + codes([], "ab");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
