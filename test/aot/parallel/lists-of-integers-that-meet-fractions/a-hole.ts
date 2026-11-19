// The list has a hole. What is printed is what plain Bun prints.
// STATISTIC: ArraysConvertedToDoubleStorage >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = list[i] * by; }
const factors: number[] = unseen([2, 0.5, 1.5, 0, -1, NaN, Infinity, 2, 0.5]);
for (const by of factors) { const list = integers(5); delete list[2]; scale(list, by); told.push(by + ": " + JSON.stringify(list) + (2 in list) + list.length); }
console.log(told.join("\n"));
