function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Job = () => number;
const firsts: Job[] = [], seconds: Job[] = [], thirds: Job[] = [];
class Calls { pick(which: boolean, job: Job): number { return which ? job() : 0; } either(good: Job, bad: Job): number { return good() - bad(); } three(a: Job, b: Job, c: Job): number { return a() + b() + c(); } }
class KeepsFirst { pick(which: boolean, job: Job): number { return which ? job() : 0; } either(good: Job, bad: Job): number { firsts.push(good); return good() - bad(); } three(a: Job, b: Job, c: Job): number { firsts.push(a); return a() + b() + c(); } }
class KeepsSecond { pick(which: boolean, job: Job): number { seconds.push(job); return which ? job() : 0; } either(good: Job, bad: Job): number { seconds.push(bad); return good() - bad(); } three(a: Job, b: Job, c: Job): number { seconds.push(b); return a() + b() + c(); } }
class KeepsAll { pick(which: boolean, job: Job): number { seconds.push(job); return 1; } either(good: Job, bad: Job): number { firsts.push(good); seconds.push(bad); return good === bad ? 1 : 0; } three(a: Job, b: Job, c: Job): number { firsts.push(a); seconds.push(b); thirds.push(c); return 3; } }
function pick(chooser: any, k: number): number { const t = chooser.pick(k % 2 === 0, () => k); return t + 1; }
function either(chooser: any, k: number): number { const t = chooser.either(() => k + 10, () => k + 20); return t + 1; }
function three(chooser: any, k: number): number { const t = chooser.three(() => k + 30, () => k + 40, () => k + 50); return t + 1; }

const choosers: any[] = [new Calls(), new KeepsFirst(), new KeepsSecond(), new KeepsAll()];
let all = 0;
for (let i = 0; i < 400; i++) { const chooser = choosers[i % 4]; all += pick(chooser, i) + either(chooser, i) + three(chooser, i); }
settle();
const sum = (jobs: Job[]) => jobs.reduce((t, job) => t + job(), 0);
console.log(all, firsts.length, seconds.length, thirds.length, sum(firsts), sum(seconds), sum(thirds));
console.log(new Set(firsts).size, new Set(seconds).size, new Set(thirds).size, new Set([...firsts, ...seconds, ...thirds]).size, firsts[0] === firsts[1], seconds.indexOf(seconds[123]), thirds.includes(firsts[0]));
