// The loop around stores integers into a list; the loop inside fills a row with fractions; the list is one of the rows, then a list apart, again and again. What is printed is what plain Bun prints.
// STATISTIC: ArraysConvertedToDoubleStorage >= 1
function sweep(rows: number[][], marks: number[], width: number): void {
  for (let row = 0; row < rows.length; row++) {
    const line = rows[row];
    marks[row] = 1;
    for (let at = 0; at < width; at++) line[at] = at / 2;
    marks[row] = 2;
  }
}
const told: string[] = [];
for (const pick of JSON.parse("[0,1,2,0]") as number[]) {
  const rows: number[][] = JSON.parse("[[9,9,9,9],[9,9,9,9],[9,9,9,9]]");
  const apart: number[] = JSON.parse("[8,8,8,8]");
  for (let round = 0; round < 4; round++) { sweep(rows, round & 1 ? apart : rows[pick], 2); told.push(pick + "." + round + ": " + rows.map(row => row.join(" ")).join(" | ") + " / " + apart.join(" ")); }
}
console.log(told.join("\n"));
