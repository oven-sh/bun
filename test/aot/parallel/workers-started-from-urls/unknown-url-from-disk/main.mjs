// Flags: --aot-allow-code-from-disk
// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The URL may name a file on disk, which starts under this flag.
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
if (process.argv.length > 5) await listen(new Worker(new URL(process.argv[5])));
console.log("none started");
