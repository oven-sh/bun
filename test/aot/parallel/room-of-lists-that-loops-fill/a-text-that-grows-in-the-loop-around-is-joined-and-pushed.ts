function report(rows: number): string {
  let text = ""; let cells = 0;
  for (let row = 0; row < rows; row++) {
    text += "ab";
    const out: string[] = [];
    for (let at = 0; at < 1000; at++) out.push(text + at);
    cells += out.length;
  }
  return text.length + ":" + cells;
}
const rows: number = JSON.parse("3");
console.log(report(rows));
export {};
