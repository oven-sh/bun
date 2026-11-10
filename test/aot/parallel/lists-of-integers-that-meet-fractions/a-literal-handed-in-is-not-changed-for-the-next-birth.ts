const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
const factors: number[] = unseen([2, 0.5, 1.5, 3, 0.25, -1, 2, 0.5]);
function scale(l: number[], by: number): void { for (let i = 0; i < l.length; i++) l[i] = l[i]! * by; }
function born(): number[] { return [1, 2, 3, 4]; }
for (const by of factors) { const l = born(); scale(l, by); told.push(by + ": " + l.join() + " | " + born().join()); }
console.log(told.join("\n"));
export {};
