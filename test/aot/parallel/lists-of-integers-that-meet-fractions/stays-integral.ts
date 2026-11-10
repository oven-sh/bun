// The factors are 2 and 0.5 in turn: no element is ever a fraction. What is printed is what plain Bun prints.
// STATISTIC: ListsConvertedInFrontOfTypedCopies >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = list[i] * by; }
const factors: number[] = unseen([2, 0.5, 1.5, 0, -1, NaN, Infinity, 2, 0.5]);
const list = integers(6);
for (let round = 0; round < 40; round++) scale(list, round & 1 ? 0.5 : 2);
told.push(list.join(), String(list[3] | 0), JSON.stringify(list));
console.log(told.join("\n"));
