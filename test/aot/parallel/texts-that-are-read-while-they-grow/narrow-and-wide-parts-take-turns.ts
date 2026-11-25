// COUNT: operation:operationAOTStackStringBuilderToString >= 60
// An escape sequence, a glyph, an escape sequence: the width changes with each part.
function paint(cells: { color: number; glyph: string }[], seen: (soFar: string) => void): string {
  let out = "";
  for (const cell of cells) {
    out += "\x1b[38;5;" + cell.color + "m";
    out += cell.glyph;
    if (cell.color !== 37) seen(out);
    out += "\x1b[0m";
  }
  return out;
}
const cells: { color: number; glyph: string }[] = [];
for (let at = 0; at < 64; at++) cells.push({ color: (at * 37) % 256, glyph: at % 5 === 0 ? "x" : String.fromCharCode(0x2500 + (at % 40)) });
let sum = 0;
let last = "";
const whole = paint(cells, soFar => {
  sum = (sum * 33 + soFar.length + soFar.charCodeAt(soFar.length - 1) + (soFar.startsWith(last) ? 1 : 1000)) | 0;
  last = soFar;
});
console.log(sum, whole.length, whole.endsWith("\x1b[0m"), JSON.stringify(whole.slice(0, 40)), JSON.stringify(whole.slice(-24)));
