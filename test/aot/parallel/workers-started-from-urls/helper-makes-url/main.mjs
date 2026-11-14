// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
const urlOf = name => new URL(name, import.meta.url);
function at(name, base) {
  return new URL(name, base);
}
console.log(typeof import.meta.url);
console.log(await listen(new Worker(urlOf("./job.mjs"))));
console.log(await listen(new Worker(at("./job.mjs", import.meta.url))));
