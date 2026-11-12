function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Step = (x: number) => number;
const kept: Step[] = [];
const target = [1, 2, 3];
const passing = new Proxy(target, { });
const keeping = new Proxy(target, { get(list, key, receiver) { return key === "forEach" ? (f: Step) => { kept.push(f); list.forEach(f); } : Reflect.get(list, key, receiver); } });
let reads = 0;
const collecting = new Proxy(target, { get(list, key, receiver) { if (++reads % 20 === 0) settle(); return Reflect.get(list, key, receiver); } });
function total(list: number[], k: number): number { let sum = 0; list.forEach(x => sum += x * k); return sum + 1; }

let all = 0;
for (let i = 0; i < 240; i++) all += total(i % 4 === 0 ? keeping : i % 4 === 1 ? passing : i % 4 === 2 ? collecting : target, i);
settle();
console.log(all, kept.length, new Set(kept).size, kept[0] === kept[1], kept.indexOf(kept[30]), kept[1](1), kept[1](1), kept[59](1));
