// the text is a rope until the first read
function codes(head: string, tail: string): string {
  const text = head + tail;
  let sum = 0;
  for (let pos = 0; pos < text.length; pos++) sum = (sum * 31 + text.charCodeAt(pos)) | 0;
  return text.length + "," + sum;
}
function deed(): string {
  return codes("abcdefghijklmnopqrstuvwxyz".repeat(3), "0123456789".repeat(4)) + "|" + codes("", "") + "|" + codes("\u4e2d".repeat(20), "abcdefghij".repeat(3));
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
