const unseen = <T>(x: T): T => [x][JSON.parse("0")];
async function base(): Promise<number> { return 10; }
function first(rows: number[]): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return rows[0] + work - 1; }
async function total(rows: number[], seen: number[]): Promise<number> {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return rows.reduce((sum, v) => { seen.push(v); return sum + v; }, first(rows) + await base());
}
async function each(table: Map<string, number>, seen: number[]): Promise<void> {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return table.forEach((v) => { seen.push(v); }, await base());
}
let sum = 0; const seen: number[] = [];
for (let turn = 0; turn < 300; turn++) { sum += await total(unseen(JSON.parse("[1,2,3]")), seen); await each(unseen(new Map([["a", 1]])), seen); }
console.log(sum, seen.length);
