function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Job = () => number;
class Square { side = 2; each(job: Job): number { return job() * this.side; } }
class Disk extends Square { jobs = new Set<Job>(); last?: Job; each(job: Job): number { this.jobs.add(job); this.last = job; return job(); } }
class Ring extends Disk { each(job: Job): number { return super.each(job) + 1; } }
function measure(shape: Square, k: number): number { const t = shape.each(() => k); return t + 1; }

const square = new Square(), disk = new Disk(), ring = new Ring();
let all = 0;
for (let i = 0; i < 300; i++) all += measure(i % 3 === 0 ? square : i % 3 === 1 ? disk : ring, i);
settle();
let sum = 0;
for (const job of disk.jobs) sum += job();
for (const job of ring.jobs) sum += job();
console.log(all, disk.jobs.size, ring.jobs.size, sum, disk.last!(), ring.last!(), disk.jobs.has(disk.last!), disk.jobs.has(ring.last!), disk.jobs.delete(disk.last!), disk.jobs.size);
