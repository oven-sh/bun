// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The start is given a URL of code or the URL of a file. The build compiles the code and follows the other URL to the file, so both Workers start.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const name = "node:worker_threads";
const { Worker: Thread } = await import(name);
const code = new URL("data:text/javascript,postMessage('the code answers')");
for (const takesCode of [false, true]) {
  const worker = new Thread(takesCode ? code : new URL("../job.js", import.meta.url));
  console.log(await new Promise(resolve => worker.once("message", resolve)));
  await worker.terminate();
}
