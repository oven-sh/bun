// Callbacks handed over: a message port runs the getters of what is posted and delivers a clone, a plain object, to a listener that is typed for the class; a direct call passes an instance.
export {};

let total = 0;

class Job {
  constructor(public id: number) {}
  get twice(): number {
    return this.id * 2;
  }
  run(): number {
    return this.id + 1;
  }
}

function handle(job: Job): void {
  total += job instanceof Job ? job.run() : typeof (job as Job).run === "function" ? 100 : 10000 + (job as Job).id;
  total += (job as Job).twice === undefined ? 1000000 : 0;
}

handle(new Job(1));
const { port1, port2 } = new MessageChannel();
const received = new Promise<void>(resolve => {
  let count = 0;
  port2.onmessage = (event: MessageEvent<Job>) => {
    handle(event.data);
    if (++count === 2) resolve();
  };
});
port1.postMessage(new Job(5));
port1.postMessage({ id: "6", get extra() { total += 100000000; return 1; } });
await received;
port1.close();
port2.close();
console.log(total);
