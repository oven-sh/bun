// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
const here = typeof import.meta === "object" ? import.meta.url : undefined;
var later = import.meta.url;
console.log(await listen(new Worker(new URL("./job.mjs", here))));
console.log(await listen(new Worker(new URL("./job.mjs", later))));
