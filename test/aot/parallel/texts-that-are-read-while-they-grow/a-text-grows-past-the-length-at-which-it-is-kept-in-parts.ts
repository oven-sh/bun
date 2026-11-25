// COUNT: operation:operationAOTStackStringBuilderToString >= 1000
// A long text is not copied at each read.
function grow(turns: number, probe: (text: string) => number): number {
  let text = "";
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    text += turn % 4 === 2 ? "│" : "ab";
    if (turn % 3 !== 1) sum = (sum + probe(text)) | 0;
  }
  return (sum * 31 + text.length) | 0;
}
console.log(
  grow(6000, text => text.length),
  grow(6000, text => text.charCodeAt(text.length >> 1)),
  grow(3000, text => (text.endsWith("│") ? 3 : text.lastIndexOf("│"))),
);
