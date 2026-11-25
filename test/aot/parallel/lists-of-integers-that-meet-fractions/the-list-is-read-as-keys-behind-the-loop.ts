const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
const factors: number[] = unseen([2, 0.5, 1.5, 3, 0.25, -1, 2, 0.5]);
const table = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
function pass(a: number[]): string { for (let i = 0; i + 1 < a.length; i++) if (a[i]! > a[i + 1]!) { const x = a[i]!; a[i] = a[i + 1]!; a[i + 1] = x; } let s = ""; for (let i = 0; i < a.length; i++) s += table[a[i]!]; return s; }
for (let k = 0; k < 6; k++) { const l = unseen([5, 3, 8, 1, 7, 2, 0].slice(k % 3)); told.push(pass(l) + " " + l.join() + " " + Object.is(l[0], 0) + " " + JSON.stringify(l)); }
console.log(told.join("\n"));
export {};
