// An async function reads an optional field, awaits, and reads it again.
// While it is suspended a promise reaction puts a getter and a setter of that name on the prototype.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Job {
  declare id: number;
  result?: number;
  constructor(id: number) {
    delete this.result;
    handOver(this);
    this.id = id;
  }
}
const log: string[] = [];
async function twice(job: Job, gate: Promise<void>) {
  const before = job.result;
  await gate;
  const after = job.result;
  job.result = 5;
  return `${before} ${after} ${job.result} [${Object.keys(job)}]`;
}

let length = 0;
for (let i = 0; i < 3000; i++) length += (await twice(new Job(i), Promise.resolve())).length;
console.log("warm", length);

const name = ["re", "sult"].join("");
const gate = Promise.resolve().then(() => {
  Object.defineProperty(Job.prototype, name, {
    get() {
      return 40;
    },
    set(this: Job, value: number) {
      log.push(`job ${this.id} = ${value}`);
    },
    configurable: true,
  });
});
console.log("across an await:", await twice(new Job(1), gate), "|", log.join(", "));
console.log("afterwards:", await twice(new Job(2), Promise.resolve()), "|", log.join(", "));
delete (Job.prototype as any)[name];
console.log("gone again:", await twice(new Job(3), Promise.resolve()), "|", log.length);
