// COUNT: operation:operationAOTStackStringBuilderToString >= 100
// `line += glyph` and the line is handed on at each turn: what is read is one string, and the next read does not put it together out of all its pieces again.
function widthOf(text: string): number {
  let width = 0;
  for (let at = 0; at < text.length; at++) width += text.charCodeAt(at) > 0x2e7f ? 2 : 1;
  return width;
}
function fit(glyphs: string[], room: number): string {
  let line = "";
  for (const glyph of glyphs) {
    line += glyph;
    if (glyph !== "é" && widthOf(line) > room) break;
  }
  return line;
}
const glyphs = ["─", "│", "a", "漢", "┌", "é", "字", "b", "┐", " "];
const rows: string[] = [];
for (let turn = 0; turn < 40; turn++) rows.push(glyphs[(turn * 7) % glyphs.length]);
let sum = 0;
for (let room = 1; room < 60; room++) {
  const line = fit(rows, room);
  sum = (sum * 31 + line.length * 7 + widthOf(line)) | 0;
}
console.log(sum, JSON.stringify(fit(rows, 12)), JSON.stringify(fit(rows, 100)));
