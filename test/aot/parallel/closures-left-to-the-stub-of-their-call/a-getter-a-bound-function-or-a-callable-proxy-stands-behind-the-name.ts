function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Job = () => number;
const kept: Job[] = [];
function calls(job: Job): number { return job() + 1; }
function keeps(job: Job): number { kept.push(job); return job(); }
function keepsSecond(first: number, job: Job): number { kept.push(job); return first + job(); }
function keepsThis(this: { jobs: Job[] }, job: Job): number { this.jobs.push(job); return this.jobs.length; }
function go(holder: any, k: number): number { const t = holder.run(() => k); return t + 1; }

let reads = 0;
const jobs: Job[] = [];
const holders: any[] = [
  { get run() { return ++reads % 2 ? calls : keeps; } },
  { get run() { if (++reads % 30 === 0) settle(); return keeps; } },
  { run: keeps.bind(null) },
  { run: calls.bind(null) },
  { run: keepsSecond.bind(null, 5) },
  { run: keepsThis.bind({ jobs }) },
  { run: keeps.bind(null).bind(null) },
  { run: new Proxy(keeps, { }) },
  { run: new Proxy(calls, { apply(target, self, list) { kept.push(list[0]); return Reflect.apply(target, self, list); } }) },
  { run: Function.prototype.call.bind(keeps, null) },
  Object.create({ run: keeps }),
  Object.defineProperty({ }, "run", { value: keeps, enumerable: false }),
];
let all = 0;
for (let i = 0; i < 600; i++) all += go(holders[i % holders.length], i);
settle();
let sum = 0;
for (const job of kept) sum += job();
for (const job of jobs) sum += job();
console.log(all, reads, kept.length, jobs.length, new Set(kept).size, new Set(jobs).size, sum, kept[3] === kept[4], kept.indexOf(kept[200]), jobs.indexOf(jobs[20]));
