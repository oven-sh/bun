// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
function listen(worker: Worker): Promise<string> {
  return new Promise<string>(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
console.log(typeof import.meta);
const url: URL = new URL("./job.ts", import.meta.url);
console.log(await listen(new Worker(url as URL)));
console.log(await listen(new Worker(new URL("./job.ts", import.meta.url) as URL, { ref: true })));
