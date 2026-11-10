// Loops in front of and behind the scaling read the list as integers. What is printed is what plain Bun prints.
// STATISTIC: ArraysConvertedToDoubleStorage >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = list[i] * by; }
const factors: number[] = unseen([2, 0.5, 1.5, 0, -1, NaN, Infinity, 2, 0.5]);
function around(list: number[], by: number): string {
  const first = list[0] | 0, length = list.length;
  let before = 0;
  for (let i = 0; i < list.length; i++) before += list[i] & 7;
  scale(list, by);
  let behind = 0;
  for (let i = 0; i < list.length; i++) behind += list[i] & 7;
  return [first, length, before, behind, list[0], list[list.length - 1]].join();
}
for (const by of factors) told.push(by + ": " + around(integers(6), by));
console.log(told.join("\n"));
