// A spread, Object.assign and a rest pattern for each record.
// Sizes: 1000 4000 16000
// Passes: 170
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
type Row = { id: number; name: string; tags: number; ok: boolean };
function next(row: Row, i: number): Row {
  return { ...row, id: i };
}
function other(row: Row): Row {
  return Object.assign({}, row, { ok: !row.ok });
}
function without({ tags, ...rest }: Row): number {
  return rest.id + tags;
}
function once(): string {
  let row: Row = { id: 0, name: "n", tags: 3, ok: true },
    sum = 0;
  for (let i = 0; i < size * 6; i++) {
    row = other(next(row, i));
    sum = (sum + without(row)) | 0;
  }
  return [sum, row.ok].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
