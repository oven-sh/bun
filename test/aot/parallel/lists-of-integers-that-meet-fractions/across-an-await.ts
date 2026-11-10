// A suspension stands between the reads and the scaling. What is printed is what plain Bun prints.
// STATISTIC: ListsConvertedInFrontOfTypedCopies >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = list[i] * by; }
const factors: number[] = unseen([2, 0.5, 1.5, 0, -1, NaN, Infinity, 2, 0.5]);
async function waits(list: number[], by: number): Promise<string> {
  const first = list[0] | 0;
  await null;
  for (let i = 0; i < list.length; i++) list[i] = list[i] * by;
  await null;
  return first + "," + list.join();
}
for (const by of factors) told.push(by + ": " + (await waits(integers(3), by)));
console.log(told.join("\n"));
