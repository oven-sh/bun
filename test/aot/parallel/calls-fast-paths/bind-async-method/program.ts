// IR+ ^function f[0-9]+ "later" \w+ role=BoundFunction
// IR+ TypeTest v[0-9]+ testedType=Function\^
// IR+ IsClosureOf v[0-9]+ function=f[0-9]+
// IR+ NewClosure \(.*\) function=f[0-9]+
declare const console: any; declare function memoryUsageStatistics(): any; declare function gc(): void;
class K { v = 1; async later(x: number): Promise<number> { return this.v + x; } }
const kept: Array<Array<(x: number) => Promise<number>>> = [];
function makes(n: number): void { for (let i = 0; i < n; i++) { if (i % 1000 === 0) kept.push([]); const k = new K(); k.v = i; kept[kept.length - 1].push(k.later.bind(k)); } }
gc(); const before = memoryUsageStatistics().heapSize;
makes(400_000);
gc(); const after = memoryUsageStatistics().heapSize;
console.log("bytes alive for an object, its bound method and the array's slot: " + Math.round((after - before) / 400_000 / 8) * 8);
async function calls(): Promise<void> { let t = 0; for (let i = 0; i < 100; i++) t += await kept[0][i](1); console.log(t, kept.length * kept[0].length, Object.getPrototypeOf(kept[0][0]) === Object.getPrototypeOf(async function () { })); }
calls();
export {};
