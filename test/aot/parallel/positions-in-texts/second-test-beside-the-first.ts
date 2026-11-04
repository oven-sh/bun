// `pos < text.length && text.charCodeAt(pos) === 32`, and a read behind the loop
function blanks(text: string): string {
  let pos = 0;
  while (pos < text.length && text.charCodeAt(pos) === 32) pos++;
  return pos + "," + text.charCodeAt(pos);
}
function deed(): string {
  return blanks("  a") + "|" + blanks("   ") + "|" + blanks("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
