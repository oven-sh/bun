const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
const factors: number[] = unseen([2, 0.5, 1.5, 3, 0.25, -1, 2, 0.5]);
function swap(a: number[], b: number[]): void { for (let i = 0, j = b.length - 1; i < j; i++, j--) if (a[i]! < b[j]! + 1000) { const x = a[i]!; a[i] = b[j]!; b[j] = x; } }
for (let k = 0; k < 6; k++) { const one = integers(7); swap(one, one); told.push(one.join()); const a = integers(7), b = integers(7); b[3] = 0.5; swap(a, b); told.push(a.join() + " " + b.join()); }
console.log(told.join("\n"));
export {};
