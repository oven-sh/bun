// The turn sums the elements, with a default where nothing is found, then stores a number of its own there. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function halves(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 0.5); return list; }
function withHoles(n: number): number[] { const list = halves(n); delete list[1]; delete list[n - 1]; list.length = n + 2; return list; }
function tell(name: string, list: number[]) { let there = ""; for (let i = 0; i < list.length; i++) there += i in list ? "x" : "."; told.push(name + ": " + JSON.stringify(list) + " " + there + " " + list.length); }
const factors: number[] = unseen([2, 0.5, 0, -1, NaN, Infinity]);
function sum(list: number[]): number { let all = 0; for (let i = 0; i < list.length; i++) { all += list[i] ?? 100.5; list[i] = i + 0.25; } return all; }
for (let round = 0; round < 3; round++) { const list = withHoles(5); told.push(round + ": " + sum(list)); tell("list", list); told.push("again: " + sum(list)); }
console.log(told.join("\n"));
