function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Job = () => number;
class Thrower { fail(f: Job): number { throw f; } failLater(f: Job): number { return this.deeper(f, 5); } deeper(f: Job, n: number): number { if (!n) throw { cause: f }; return this.deeper(f, n - 1) + 1; } }
function caughtHere(thrower: any, k: number): Job { try { const t = thrower.fail(() => k); return () => t; } catch (thrown) { return thrown as Job; } }
function throwsThrough(thrower: any, k: number): number { const t = thrower.failLater(() => k + 1); return t + 1; }
function caughtAbove(thrower: any, k: number): Job { try { throwsThrough(thrower, k); } catch (thrown) { return (thrown as { cause: Job }).cause; } return () => -1; }

const thrower = new Thrower();
const here: Job[] = [], above: Job[] = [];
const marks = new WeakMap<Job, number>();
for (let i = 0; i < 200; i++) { here.push(caughtHere(thrower, i)); above.push(caughtAbove(thrower, i)); marks.set(here[i], i); }
settle();
let wrong = 0;
for (let i = 0; i < 200; i++) if (here[i]() !== i || above[i]() !== i + 1 || marks.get(here[i]) !== i || marks.has(above[i])) wrong++;
console.log(wrong, new Set(here).size, new Set(above).size, here[7] === here[8], above.indexOf(above[120]), here[199](), above[199]());
