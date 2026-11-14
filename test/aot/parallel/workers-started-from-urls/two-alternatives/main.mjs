// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
const url = process.env.TAKE_THE_OTHER_JOB ? new URL("./other.mjs", import.meta.url) : new URL("./job.mjs", import.meta.url);
console.log(await listen(new Worker(url)));
console.log(await listen(new Worker(url)));
