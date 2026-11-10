function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
const kept: Array<(x: number) => number> = [];
const keeping: any = [1, 2]; keeping.forEach = function (this: number[], f: (x: number) => number) { kept.push(f); for (const x of this) f(x); };
function nested(list: number[], depth: number, k: number): number { let sum = 0; list.forEach(x => sum += depth ? nested(depth === 2 ? keeping : list, depth - 1, x + k) : x * k); return sum + 1; }
function shrinking(list: number[], k: number): number { let sum = 0; list.forEach(x => { if (x === 2) list.length = 2; if (x === 1) list[40] = 5; return sum += x * k; }); return sum + 1; }
function collecting(list: number[], k: number): number { let sum = 0; list.forEach(x => { if (x === k) settle(); return sum += x * k; }); return sum + 1; }
function throwing(list: number[], k: number): number { let sum = 0; try { list.forEach(x => { if (x > k) throw new RangeError("over " + k); return sum += x; }); sum += 100; } catch (error) { sum += (error as Error).message.length; } return sum + 1; }
function throwingThrough(list: number[], k: number): number { let sum = 0; list.forEach(x => { if (x > k) throw sum; return sum += x; }); return sum + 1; }

let all = 0;
for (let i = 0; i < 60; i++) all += nested([1, 2, 3], 3, i);
settle();
console.log(all, kept.length, new Set(kept).size, kept[0](1), kept[kept.length - 1](1), kept[0] === kept[1]);
for (let i = 0; i < 60; i++) all += shrinking([1, 2, 3, 4], i) + throwing([1, 2, 3, 4], i % 6);
for (let i = 0; i < 6; i++) all += collecting([1, 2, 3, 4], i);
let thrown = 0;
for (let i = 0; i < 60; i++) { try { all += throwingThrough([1, 2, 3, 4], i % 6); } catch (sum) { thrown += sum as number; } }
console.log(all, thrown);
