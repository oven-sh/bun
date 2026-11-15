const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
const factors: number[] = unseen([2, 0.5, 1.5, 3, 0.25, -1, 2, 0.5]);
function pass(a: number[]): void { for (let i = 0; i + 1 < a.length; i++) if (a[i]! > a[i + 1]!) { const x = a[i]!; a[i] = a[i + 1]!; a[i + 1] = x; } }
for (let k = 0; k < 6; k++) { const l: number[] = unseen([0, -1, 2147483647, -2147483648, 0, 5]); pass(l); told.push(l.map(v => Object.is(v, -0) ? "-0" : String(v)).join() + " " + l.map(v => 1 / v).join()); }
console.log(told.join("\n"));
export {};
