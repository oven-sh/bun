// The prototype is moved to an object without elements; an element is laid there later, between two runs of the loop. What is printed is what plain Bun prints.
// STATISTIC: HolesReadAsNaNInTurnsThatStore >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function halves(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 0.5); return list; }
function withHoles(n: number): number[] { const list = halves(n); delete list[1]; delete list[n - 1]; list.length = n + 2; return list; }
function tell(name: string, list: number[]) { let there = ""; for (let i = 0; i < list.length; i++) there += i in list ? "x" : "."; told.push(name + ": " + JSON.stringify(list) + " " + there + " " + list.length); }
const factors: number[] = unseen([2, 0.5, 0, -1, NaN, Infinity]);
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = list[i] * by; }
const above: any = Object.create(Array.prototype);
const list = halves(5); Object.setPrototypeOf(list, above); scale(list, 2); tell("first", list); list.length = 8; above[6] = 300.5; scale(list, 2); tell("second", list);
const other = withHoles(5); scale(other, 2); tell("as made", other);
console.log(told.join("\n"));
