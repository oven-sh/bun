function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Step = (x: number) => number;
const kept: Step[] = [];
const seen = new Set<Step>();
const likeList: any = { length: 2, 0: 7, 1: 8, forEach(f: Step) { kept.push(f); seen.add(f); for (let i = 0; i < this.length; i++) f(this[i]); } };
function total(list: number[], k: number): number { let sum = 0; list.forEach(x => sum += x * k); return sum + 1; }
function attempt(list: any, k: number): string { try { return String(total(list, k)); } catch (error) { return (error as Error).constructor.name; } }

let all = 0;
for (let i = 0; i < 300; i++) all += total(i % 3 ? [1, 2, i] : likeList, i);
settle();
console.log(all, kept.length, seen.size, kept[0] === kept[1], kept.indexOf(kept[99]), seen.delete(kept[5]), seen.has(kept[5]), seen.size);
console.log(kept[1](1), kept[1](1), kept[99](2), kept[0](5));
const others: any[] = [new Float64Array([1, 2]), new Set([3, 4]), new Map([[5, 6]]), "text", 7, null, undefined, { }, { forEach: 1 }, likeList];
for (let turn = 0; turn < 3; turn++) console.log(others.map(other => attempt(other, turn + 2)).join(" "));
settle();
console.log(kept.length, seen.size, kept[kept.length - 1](1), kept[kept.length - 1] === kept[kept.length - 2]);
