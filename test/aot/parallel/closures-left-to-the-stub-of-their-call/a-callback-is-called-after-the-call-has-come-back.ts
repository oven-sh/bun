function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Job = () => number;
const out: number[] = [];
const waiting = new Set<Job>();
class Later {
  soon(f: Job): number { waiting.add(f); queueMicrotask(() => { out.push(f()); waiting.delete(f); }); return 1; }
  timer(f: Job): number { waiting.add(f); setTimeout(() => { out.push(f()); waiting.delete(f); }, 0); return 2; }
  settled(f: Job): number { waiting.add(f); Promise.resolve().then(f).then(value => { out.push(value); waiting.delete(f); }); return 3; }
}
function soon(later: any, k: number): number { const t = later.soon(() => k); return t + 1; }
function timer(later: any, k: number): number { const t = later.timer(() => k + 1000); return t + 1; }
function settled(later: any, k: number): number { const t = later.settled(() => k + 2000); return t + 1; }
function then(promise: Promise<number>, k: number): number { const next = promise.then(value => { out.push(value + k + 3000); return value; }); return next === promise ? 1 : 0; }
function both(promise: any, k: number): number { const next = promise.then((value: number) => { out.push(value + k + 4000); }, (reason: number) => { out.push(reason + k + 5000); }); return next === promise ? 1 : 0; }

const later = new Later();
let all = 0;
for (let i = 0; i < 40; i++) all += soon(later, i) + timer(later, i) + settled(later, i) + then(Promise.resolve(i), i) + both(i % 2 ? Promise.resolve(i) : Promise.reject(i), i);
console.log(all, out.length, waiting.size);
settle();
setTimeout(() => { settle(); console.log(out.length, waiting.size, out.reduce((sum, value) => sum + value, 0), out.slice(0, 6).join(" "), out.slice(-4).join(" ")); }, 5);
