// Built-in methods take the list behind the scaling. What is printed is what plain Bun prints.
// STATISTIC: ArraysConvertedToDoubleStorage >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = list[i] * by; }
const factors: number[] = unseen([2, 0.5, 1.5, 0, -1, NaN, Infinity, 2, 0.5]);
for (const by of factors) { const list = integers(5); scale(list, by); told.push(by + ": " + [list.slice(1, 3).join(), list.map(x => x + 1).join(), list.reduce((a, b) => a + b, 0), list.concat([9]).join(), [...list].reverse().join(), list.lastIndexOf(4), Math.max(...list), list.sort().join()].join(" ")); }
console.log(told.join("\n"));
