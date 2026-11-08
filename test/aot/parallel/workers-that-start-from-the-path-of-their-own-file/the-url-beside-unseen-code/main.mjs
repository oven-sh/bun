// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
const unseen = (0, eval)("(x) => x");
if (Bun.isMainThread) {
  const worker = new Worker(import.meta.url);
  const said = await new Promise((resolve) => { worker.onmessage = (event) => resolve("says " + event.data); worker.onerror = () => resolve("fails"); });
  worker.terminate();
  console.log(unseen(said));
} else {
  postMessage("main thread: " + Bun.isMainThread);
}
