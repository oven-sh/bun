// IR+ function [0-9]+ "bound later" Bound
// IR+ IsClosureOf v[0-9]+ f[0-9]+ as made
// IR+ NewClosure f[0-9]+
declare const console: any; declare function memoryUsageStatistics(): any; declare function gc(): void;
class K { v = 1; async later(x: number): Promise<number> { return this.v + x; } }
const kept: Array<(x: number) => Promise<number>> = [];
function makes(n: number): void { for (let i = 0; i < n; i++) { const k = new K(); k.v = i; kept.push(k.later.bind(k)); } }
gc(); const before = memoryUsageStatistics().heapSize;
makes(400_000);
gc(); const after = memoryUsageStatistics().heapSize;
console.log("bytes alive for an object, its bound method and the array's slot: " + Math.round((after - before) / 400_000));
async function calls(): Promise<void> { let t = 0; for (let i = 0; i < 100; i++) t += await kept[i](1); console.log(t, kept.length, Object.getPrototypeOf(kept[0]) === Object.getPrototypeOf(async function () { })); }
calls();
export {};
