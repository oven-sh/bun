// As TypeScript's scanner is written: the variables are declared without a value, the text is read through a closure, and the flags are written behind the step.
// The loop of skipComment() is built twice: in its typed copy pos and end are asked for an int32 where the turn first uses them, and where that fails the turn begins again in the other copy.
// STATISTIC: LoopsBuiltTwice >= 1
// STATISTIC: TurnsThatBeginAgain >= 1
function isLineBreak(ch: number): boolean { return ch === 10 || ch === 13 || ch === 8232 || ch === 8233; }
function createScanner() {
  var text: string; var pos: number; var end: number; var lines = 0; var tokenFlags: number;
  function charCodeUnchecked(p: number) { return text.charCodeAt(p); }
  function skipComment(): number {
    while (pos < end) {
      const ch = charCodeUnchecked(pos);
      if (ch === 42 && charCodeUnchecked(pos + 1) === 47) { pos += 2; break; }
      pos++;
      if (isLineBreak(ch)) { tokenFlags |= 1; lines++; }
    }
    return pos;
  }
  function setText(t: string, start: number) { text = t; pos = start; end = t.length; tokenFlags = 0; }
  return { skipComment, setText, getLines: () => lines, getFlags: () => tokenFlags };
}
const scanner = createScanner();
(globalThis as any).keptOutside = scanner;
scanner.setText("one * two\nthree */ four", 0);
console.log(scanner.skipComment(), scanner.getLines(), scanner.getFlags());
scanner.setText("no end\r\n of it", 3);
console.log(scanner.skipComment(), scanner.getLines(), scanner.getFlags());
export {};
