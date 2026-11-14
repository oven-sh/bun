// One loop reads a list as integers under one name and scales it under another; the two names are one list, then two. What is printed is what plain Bun prints.
// STATISTIC: ArraysConvertedToDoubleStorage >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
const factors: number[] = unseen([2, 0.5, 1.5, 3, 0.25, -1, 2, 0.5]);
function both(read: number[], written: number[], by: number): number {
  let sum = 0;
  for (let i = 0; i < written.length; i++) { sum += read[i] | 0; written[i] = written[i] * by; sum += read[i] | 0; }
  return sum;
}
for (const by of factors) { const one = integers(6); told.push(by + ": " + both(one, one, by) + " " + one.join()); const a = integers(6), b = integers(6); told.push(by + ": " + both(a, b, by) + " " + a.join() + " " + b.join()); }
console.log(told.join("\n"));
