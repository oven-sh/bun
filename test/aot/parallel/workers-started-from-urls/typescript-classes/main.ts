// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
function listen(worker: Worker): Promise<string> {
  return new Promise<string>(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
class Pool {
  private readonly url: URL = new URL("./job.ts", import.meta.url);
  start(): Worker {
    return new Worker(this.url);
  }
}
class Job {
  static readonly file: URL = new URL("./job.ts", import.meta.url);
  constructor(private readonly url: URL = Job.file) {}
  start(): Worker {
    return new Worker(this.url);
  }
}
console.log(await listen(new Pool().start()));
console.log(await listen(new Job().start()));
