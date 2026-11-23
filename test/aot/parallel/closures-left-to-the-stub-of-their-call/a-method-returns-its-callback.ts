function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Job = () => number;
class Box { pass(f: Job): Job { return f; } pair(f: Job): Job[] { return [f, f]; } wrap(f: Job): { job: Job } { return { job: f }; } }
let made = 0;
function passed(box: any, k: number): Job { const same = box.pass(() => k); made++; return same; }
function paired(box: any, k: number): Job[] { const both = box.pair(() => k + 1); made++; return both; }
function wrapped(box: any, k: number): { job: Job } { const holder = box.wrap(() => k + 2); made++; return holder; }

const box = new Box();
const jobs: Job[] = [];
for (let i = 0; i < 300; i++) jobs.push(passed(box, i));
settle();
let wrong = 0;
for (let i = 0; i < 300; i++) if (jobs[i]() !== i) wrong++;
console.log(made, wrong, new Set(jobs).size, jobs[4] === jobs[4], jobs[4] === jobs[5], jobs.indexOf(jobs[250]), passed(box, 1) === passed(box, 1));
const pairs: Job[][] = [];
for (let i = 0; i < 100; i++) pairs.push(paired(box, i));
settle();
console.log(pairs.every(([first, second]) => first === second), pairs[3][0] === pairs[4][0], pairs[99][1](), new Set(pairs.flat()).size);
const holders: { job: Job }[] = [];
for (let i = 0; i < 100; i++) holders.push(wrapped(box, i));
settle();
console.log(holders[0].job(), holders[99].job(), holders[5].job === holders[5].job, holders[5].job === holders[6].job);
