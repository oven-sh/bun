// A loop around reads the list under another name, as integers, while the loop inside scales it. What is printed is what plain Bun prints.
// STATISTIC: ArraysConvertedToDoubleStorage >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = list[i] * by; }
const factors: number[] = unseen([2, 0.5, 1.5, 0, -1, NaN, Infinity, 2, 0.5]);
function both(read: number[], written: number[], by: number): number {
  let sum = 0;
  for (let j = 0; j < read.length; j++) {
    sum += read[j] | 0;
    for (let i = 0; i < written.length; i++) written[i] = written[i] * by;
    sum += read[j] | 0;
  }
  return sum;
}
for (const by of factors) { const one = integers(4); told.push(by + ": " + both(one, one, by) + " " + one.join()); }
console.log(told.join("\n"));
