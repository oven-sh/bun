// The prototype of a list with holes is moved to an object that has elements at the places of two holes: the reads find them. What is printed is what plain Bun prints.
// STATISTIC: StoringLoopHoleChecksRemoved >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function halves(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 0.5); return list; }
function withHoles(n: number): number[] { const list = halves(n); delete list[1]; delete list[n - 1]; list.length = n + 2; return list; }
function tell(name: string, list: number[]) { let there = ""; for (let i = 0; i < list.length; i++) there += i in list ? "x" : "."; told.push(name + ": " + JSON.stringify(list) + " " + there + " " + list.length); }
const factors: number[] = unseen([2, 0.5, 0, -1, NaN, Infinity]);
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = list[i] * by; }
const above: any = Object.create(Array.prototype); above[1] = 100.5; above[5] = 200.5;
for (const by of factors) { const plain = withHoles(5); scale(plain, by); tell("as made " + by, plain); const moved = withHoles(5); Object.setPrototypeOf(moved, above); scale(moved, by); tell("moved " + by, moved); }
console.log(told.join("\n"));
