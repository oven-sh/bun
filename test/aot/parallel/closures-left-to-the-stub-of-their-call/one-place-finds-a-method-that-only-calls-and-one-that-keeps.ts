function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Job = () => number;
const kept: Job[] = [];
class Calls { run(job: Job): number { return job() + job(); } }
class Keeps { run(job: Job): number { kept.push(job); return job(); } }
class KeepsSometimes { turns = 0; run(job: Job): number { if (++this.turns % 5 === 0) kept.push(job); return job(); } }
class Changes { run(job: Job): number { return job() * 3; } }
function go(runner: any, k: number): number { const t = runner.run(() => k); return t + 1; }

const runners: any[] = [new Calls(), new Keeps(), new KeepsSometimes(), new Changes(), { run: (job: Job) => job() - 1 }, { run(job: Job) { kept.push(job); return 0; } }];
let all = 0;
for (let i = 0; i < 100; i++) all += go(runners[0], i);
for (let i = 0; i < 100; i++) all += go(runners[1], i);
for (let i = 0; i < 600; i++) all += go(runners[i % runners.length], i);
settle();
console.log(all, kept.length, new Set(kept).size, kept[0](), kept[99](), kept[kept.length - 1](), kept[5] === kept[6], kept.indexOf(kept[150]));
Changes.prototype.run = function (job: Job): number { kept.push(job); return 7; };
const before = kept.length;
for (let i = 0; i < 60; i++) all += go(runners[3], i);
Calls.prototype.run = Keeps.prototype.run;
for (let i = 0; i < 60; i++) all += go(runners[0], i + 500);
settle();
let wrong = 0;
for (let i = 0; i < 60; i++) if (kept[before + i]() !== i || kept[before + 60 + i]() !== i + 500) wrong++;
console.log(all, kept.length - before, wrong, new Set(kept).size);
