// a switch on the char code, and a second read behind the step that may lie at the end
function lineStarts(text: string): string {
  const starts: number[] = [];
  let pos = 0;
  let lineStart = 0;
  while (pos < text.length) {
    const ch = text.charCodeAt(pos);
    pos++;
    switch (ch) {
      case 13:
        if (text.charCodeAt(pos) === 10) pos++;
      case 10:
        starts.push(lineStart);
        lineStart = pos;
        break;
      default:
        if (ch > 127 && (ch === 0x2028 || ch === 0x2029)) {
          starts.push(lineStart);
          lineStart = pos;
        }
        break;
    }
  }
  starts.push(lineStart);
  return starts.join();
}
function deed(): string {
  return lineStarts("a\r\nb\nc\r") + "|" + lineStarts("\r") + "|" + lineStarts("") + "|" + lineStarts("a\u2028b\u2029");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
