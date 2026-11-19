// A number is divided by each element of a list of doubles with holes, in place. What is printed is what plain Bun prints.
// STATISTIC: StoringLoopHoleChecksRemoved >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function halves(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 0.5); return list; }
function withHoles(n: number): number[] { const list = halves(n); delete list[1]; delete list[n - 1]; list.length = n + 2; return list; }
function tell(name: string, list: number[]) { let there = ""; for (let i = 0; i < list.length; i++) there += i in list ? "x" : "."; told.push(name + ": " + JSON.stringify(list) + " " + there + " " + list.length); }
const factors: number[] = unseen([2, 0.5, 0, -1, NaN, Infinity]);
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = by / list[i]; }
for (const by of factors) { const list = withHoles(5); scale(list, by); tell("once " + by, list); scale(list, by); tell("twice " + by, list); const whole = halves(5); scale(whole, by); tell("no hole " + by, whole); }
console.log(told.join("\n"));
