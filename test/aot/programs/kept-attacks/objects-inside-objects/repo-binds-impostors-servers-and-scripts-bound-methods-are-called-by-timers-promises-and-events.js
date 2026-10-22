// Objects inside objects: repo binds impostors servers and scripts bound methods are called by timers promises and events. It prints what plain Bun prints.
import { EventEmitter } from "node:events";

class Job {
  constructor(name) {
    this.name = name;
    this.runs = 0;
  }
  run(...values) {
    this.runs++;
    console.log(this.name, "ran with", values.length, "values");
    return this.runs;
  }
}

const job = new Job("job");
console.log("called directly", job.run.bind(job)());
[1].forEach(job.run.bind(job));
await Promise.resolve("value").then(job.run.bind(job));
await new Promise(resolve => {
  queueMicrotask(job.run.bind(job));
  process.nextTick(job.run.bind(job));
  setImmediate(job.run.bind(job));
  setTimeout(job.run.bind(job), 1);
  setTimeout(resolve, 20);
});
const emitter = new EventEmitter();
emitter.on("go", job.run.bind(job));
emitter.emit("go", 1, 2);
const target = new EventTarget();
target.addEventListener("go", job.run.bind(job));
target.dispatchEvent(new Event("go"));
const controller = new AbortController();
controller.signal.addEventListener("abort", job.run.bind(job));
controller.abort();
console.log(job.runs);
