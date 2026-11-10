class Point { x: number; constructor(x: number) { this.x = x; } }
class Far extends Point { z = 7; }
const values: any[] = [new Point(1), new Far(2), { x: 3 }, undefined, null, 0, -0, NaN, 1, 0.5, "", "a", 0n, 1n, false, true, Symbol.iterator, function named() {}, [], new Proxy(new Point(5), {}), Object.create(null), [1, , 3][1]];
function show(v: any): string { return typeof v === "object" && v !== null ? "object:" + String(v.x) : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v); }
const shelf: any = ((globalThis as any).shelf = {});
shelf.f = function (table: any, key: number, other: any): any { const found: Point | undefined = table[key]; return found ? other : found; };
const table: any[] = values.slice(); delete table[2];
for (let round = 0; round < 2; round++) for (let i = 0; i < table.length + 2; i++) console.log(i, show(Reflect.apply(shelf.f, undefined, [table, i, new Point(100 + i)])));
export {};
