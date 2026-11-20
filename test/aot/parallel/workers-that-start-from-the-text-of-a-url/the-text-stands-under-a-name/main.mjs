// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
const href = new URL("./job.mjs", import.meta.url).href;
const worker = new Worker(href);
const said = await new Promise((resolve) => { worker.onmessage = (event) => resolve("says " + event.data); worker.onerror = () => resolve("fails"); });
worker.terminate();
console.log(said);
