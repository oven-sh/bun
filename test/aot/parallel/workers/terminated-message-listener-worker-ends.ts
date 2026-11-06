// A Worker posts one message and ends by itself; its 'message' listener calls terminate() and waits for it. First one Worker alone, then rounds of sixteen. COUNT says how many in all.
import { isMainThread, parentPort, Worker } from "node:worker_threads";

type Answer = { text: string; code: string };

function ask(): Promise<Answer> {
  return new Promise(resolve => {
    const worker = new Worker(new URL(import.meta.url));
    worker.once("message", (text: string) => {
      void worker.terminate().then(code => resolve({ text, code: typeof code }));
    });
  });
}

if (isMainThread) {
  const count = Number(process.env.COUNT ?? 65);
  const first = await ask();
  console.log("the first:", first.text, first.code);
  let right = 1;
  while (right < count) {
    const round = await Promise.all(Array.from({ length: Math.min(16, count - right) }, ask));
    if (!round.every(answer => answer.text === "answer" && answer.code === "number")) break;
    right += round.length;
  }
  console.log("all:", right === count);
} else {
  parentPort!.postMessage("answer");
}
