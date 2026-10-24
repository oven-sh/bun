// Async functions that stand behind many conditions or in a catch clause, so that nothing says they run often, walk what they are handed with for..of, with a spread and by index.
// What arrives is what the types say, and then it is not.
type Row = { id: number };

async function walks(rows: Row[], first: Row): Promise<number> {
  let n = first.id;
  for (const row of rows) n += row.id;
  await null;
  return n;
}
async function walksInCatch(rows: Row[], first: Row): Promise<number> {
  let n = first.id;
  for (const row of rows) n += row.id;
  await null;
  return n;
}
async function spreadsInLoop(rows: Row[], times: number): Promise<number> {
  let n = 0;
  for (let i = 0; i < times; i++) {
    const copy = [...rows];
    n += copy[i % copy.length].id + rows[0].id;
  }
  await null;
  return n;
}
async function byIndex(rows: Row[], first: Row): Promise<number> {
  let n = first.id;
  for (let i = 0; i < rows.length; i++) n += rows[i].id;
  await null;
  return n;
}

const rows: Row[] = JSON.parse('[{"id":1},{"id":2},{"id":3}]');
const odd: any = [{ id: 1 }, { id: "two" }, { get id() { return 3; } }, Object.create({ id: 4 })];
const notAnArray: any = new Set(rows);
const flags: number[] = JSON.parse("[1,1,1,1,1]");
const out: unknown[] = [];
if (flags[0]) if (flags[1]) if (flags[2]) if (flags[3]) if (flags[4]) {
  out.push(await walks(rows, rows[0]), await walks(odd, odd[1]), await walks(notAnArray, rows[2]));
  out.push(await spreadsInLoop(rows, 4), await spreadsInLoop(odd, 4));
  out.push(await byIndex(rows, rows[0]), await byIndex(odd, odd[1]));
}
try {
  if (flags[0]) throw new Error("x");
} catch {
  out.push(await walksInCatch(rows, rows[0]), await walksInCatch(odd, odd[3]));
}
console.log(JSON.stringify(out));
