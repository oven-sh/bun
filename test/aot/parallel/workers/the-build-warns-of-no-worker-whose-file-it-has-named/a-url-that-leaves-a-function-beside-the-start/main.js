// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The engine lists every URL that leaves a function beside those that start a Worker. The build warns only of a URL that the load saw given to a start.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const worker = new Worker(new URL("../job.js", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
function address(request) {
  return new URL(request.url, "http://localhost");
}
console.log(address({ url: "/jobs" }).href);
