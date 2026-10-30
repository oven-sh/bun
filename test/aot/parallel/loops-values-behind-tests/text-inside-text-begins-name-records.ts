// An outer loop puts lines together and an inner loop the cells of a line. A line begins with the name of a record, which only some records have.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: number[] } | { kind: 1; name: string } | { kind: 2 };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(from: number, rows: number, cells: number): string {
  let page = "";
  for (let row = 0; row < rows; row++) {
    const r = make(from + row);
    let line = "-";
    if (r.kind === 1) {
      line = r.name + ":";
      for (let cell = 0; cell < cells; cell++) line += cell + ";";
    }
    page += line + "|";
  }
  return page;
}
let total = 0;
for (let i = 0; i < 200; i++) total = mix(total, work(i, 9, 5).length);
console.log(total, work(0, 5, 2));
