// One loop reads under two names and scales under a third; the names are one list, or two in every way. What is printed is what plain Bun prints.
// STATISTIC: ListsConvertedInFrontOfTypedCopies >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
const factors: number[] = unseen([2, 0.5, 1.5, 3, 0.25, -1, 2, 0.5]);
function three(first: number[], written: number[], last: number[], by: number): number {
  let sum = 0;
  for (let i = 0; i < written.length; i++) { sum += first[i] & 15; written[i] = written[i] * by; sum += last[i] & 15; }
  return sum;
}
for (const by of factors) { const one = integers(6); told.push(by + ": " + three(one, one, one, by) + " " + one.join()); const a = integers(6), b = integers(6); told.push(by + ": " + three(a, b, a, by) + " " + three(a, a, b, by) + " " + three(b, a, a, by) + " " + a.join() + " " + b.join()); }
console.log(told.join("\n"));
