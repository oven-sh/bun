// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
console.log(typeof import.meta);
class Pool {
  #url = new URL("./job.mjs", import.meta.url);
  start() {
    return new Worker(this.#url);
  }
}
class Job {
  constructor(name) {
    this.worker = new Worker(new URL(name, import.meta.url));
  }
}
class Lazy {
  get url() {
    return new URL("./job.mjs", import.meta.url);
  }
  start() {
    return new Worker(this.url);
  }
}
console.log(await listen(new Pool().start()));
console.log(await listen(new Job("./job.mjs").worker));
console.log(await listen(new Lazy().start()));
