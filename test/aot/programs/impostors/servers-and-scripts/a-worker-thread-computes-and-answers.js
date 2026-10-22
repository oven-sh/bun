import { Worker, isMainThread, parentPort, threadId, workerData } from "node:worker_threads";

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { base: 10 } });
  const answers = [];
  worker.on("online", () => answers.push("online"));
  worker.on("message", message => {
    answers.push(message);
    if (message.done) worker.postMessage({ stop: true });
  });
  worker.on("error", error => answers.push("error " + error.message));
  worker.postMessage({ numbers: [1, 2, 3] });
  worker.postMessage({ numbers: new Float64Array([0.5, 0.25]), done: true });
  const code = await new Promise(resolve => worker.on("exit", resolve));
  console.log(answers, code, threadId, typeof worker.threadId);

  const failing = new Worker(new URL(import.meta.url), { workerData: { fail: true } });
  console.log(await new Promise(resolve => failing.on("error", error => resolve(error.name + ": " + error.message))));
  const ended = new Worker(new URL(import.meta.url), { workerData: { forever: true } });
  await new Promise(resolve => ended.once("message", resolve));
  console.log(typeof (await ended.terminate()));
} else {
  if (workerData.fail) throw new RangeError("the worker fails on purpose");
  if (workerData.forever) {
    parentPort.postMessage("ready");
    setInterval(() => {}, 1000);
  }
  parentPort.on("message", message => {
    if (message.stop) process.exit(7);
    let sum = workerData.base;
    for (const n of message.numbers) sum += n;
    parentPort.postMessage({ sum, done: message.done === true, main: isMainThread, positive: threadId > 0 });
  });
}
