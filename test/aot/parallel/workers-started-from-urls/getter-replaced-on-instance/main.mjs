// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
class Pool {
  get url() {
    return new URL("./job.mjs", import.meta.url);
  }
  start() {
    return new Worker(this.url);
  }
}
const pool = new Pool();
Object.defineProperty(pool, "url", { value: new URL("./other.mjs", import.meta.url) });
console.log(await listen(pool.start()));
