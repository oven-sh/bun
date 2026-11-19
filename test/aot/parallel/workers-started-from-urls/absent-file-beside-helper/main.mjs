// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
console.log(typeof (meta => meta.url)(import.meta));
const url = new URL("./absent.mjs", import.meta.url);
console.log(await listen(new Worker(url.href)));
