// What a callee throws leaves it as surely as what it returns: the parameter itself, an error that holds it in a property or as its cause, a closure over it; thrown on a rare path, several frames down, caught far above, through `finally`, or as the reason of a rejected promise.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Job {
  id: number;
  tag: string;
}
class JobError extends Error {
  constructor(
    message: string,
    public job: Job,
  ) {
    super(message);
  }
}
function throwsItself(job: Job): number {
  if (job.id % 100 === 99) throw job;
  return job.id;
}
function throwsInAProperty(job: Job): number {
  if (job.id % 100 === 98) throw new JobError("failed", job);
  return job.id;
}
function throwsAsCause(job: Job): number {
  if (job.id % 100 === 97) throw new Error("with a cause", { cause: job });
  return job.id;
}
function throwsAClosure(job: Job): number {
  if (job.id % 100 === 96) throw () => job.tag;
  return job.id;
}
function throwsInAList(job: Job): number {
  if (job.id % 100 === 95) throw [job, job];
  return job.id;
}
function level3(job: Job, which: number): number {
  switch (which) {
    case 0:
      return throwsItself(job);
    case 1:
      return throwsInAProperty(job);
    case 2:
      return throwsAsCause(job);
    case 3:
      return throwsAClosure(job);
    default:
      return throwsInAList(job);
  }
}
let cleanups = 0;
function level2(job: Job, which: number): number {
  try {
    return level3(job, which) + 1;
  } finally {
    cleanups++;
  }
}
function level1(job: Job, which: number): number {
  try {
    return level2(job, which) + 1;
  } catch (error) {
    if (which === 4) throw { rethrown: error };
    throw error;
  }
}
const caught: unknown[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  for (let which = 0; which < 5; which++) {
    try {
      sum += level1({ id: i, tag: "job " + i + "/" + which }, which);
    } catch (error) {
      caught.push(error);
    }
  }
}
console.log(sum, cleanups, churn(60), caught.length);
function describe(error: unknown): string {
  if (error instanceof JobError) return "JobError " + error.message + " " + error.job.tag;
  if (error instanceof Error) return "Error " + error.message + " " + (error.cause as Job).tag;
  if (typeof error === "function") return "closure " + error();
  const object = error as { rethrown?: Job[]; tag?: string };
  if (object.rethrown) return "rethrown " + object.rethrown[0].tag + " " + (object.rethrown[0] === object.rethrown[1]);
  return "itself " + object.tag;
}
console.log(caught.map(describe).join("\n"));

// The catch is in the caller itself, which made the object: it compares what it caught with what it passed.
function check(job: Job): void {
  if (job.id & 1) throw job;
}
function sameObjectComesBack(i: number): boolean {
  const job = { id: i, tag: "local " + i };
  try {
    check(job);
    return false;
  } catch (error) {
    return error === job;
  }
}
let same = 0;
for (let i = 0; i < 200; i++) if (sameObjectComesBack(i)) same++;
console.log(same);

// A rejection.
async function rejectsWith(job: Job): Promise<number> {
  if (job.id % 50 === 49) throw job;
  return job.id;
}
function rejectsLater(job: Job): Promise<number> {
  return new Promise((resolve, reject) => (job.id % 50 === 48 ? queueMicrotask(() => reject(job)) : resolve(job.id)));
}
const settled: Promise<PromiseSettledResult<number>[]>[] = [];
for (let i = 0; i < 100; i++) settled.push(Promise.allSettled([rejectsWith({ id: i, tag: "async " + i }), rejectsLater({ id: i, tag: "later " + i })]));
churn(60);
const reasons: string[] = [];
for (const pair of await Promise.all(settled)) for (const result of pair) if (result.status === "rejected") reasons.push((result.reason as Job).tag);
console.log(reasons.join());

// `finally` throws over a return, and returns over a throw.
function finallyThrows(a: Job, b: Job): Job {
  try {
    return a;
  } finally {
    if (b.id === 1) throw b;
  }
}
function finallyReturns(a: Job, b: Job): Job {
  try {
    throw a;
  } finally {
    if (b.id === 1) return b;
  }
}
function tryBoth(i: number): string {
  const a = { id: 0, tag: "a" + i };
  const b = { id: i & 1, tag: "b" + i };
  let out = "";
  for (const f of [finallyThrows, finallyReturns]) {
    try {
      out += "returned " + f(a, b).tag + " ";
    } catch (error) {
      out += "threw " + (error as Job).tag + " ";
    }
  }
  return out;
}
let text = "";
for (let i = 0; i < 100; i++) text = tryBoth(i) + tryBoth(i + 1);
console.log(text);
