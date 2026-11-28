// A Worker has an environment of its own, unless it shares that of the process. Nothing here replaces process.env.
const { win32 } = require("node:path");
const { Worker, SHARE_ENV, isMainThread, parentPort } = require("node:worker_threads");
if (isMainThread) {
  (async () => {
    for (const env of [undefined, { "=Q:": "Q:\\given" }, SHARE_ENV]) {
      console.log(await new Promise(resolve => new Worker(__filename, { env }).once("message", resolve)));
    }
  })();
} else {
  process.cwd = () => "Q:\\cwd";
  parentPort.postMessage(win32.resolve("Q:a"));
}
