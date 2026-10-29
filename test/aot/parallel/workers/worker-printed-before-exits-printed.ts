// A Worker prints two lines and calls process.exit(); the lines are printed ahead of its 'exit' event. First one Worker alone, then one after the other. COUNT says how many in all.
import { isMainThread, threadId, Worker } from "node:worker_threads";

function run(): Promise<number> {
  return new Promise(resolve => new Worker(new URL(import.meta.url)).on("exit", resolve));
}

if (isMainThread) {
  const count = Number(process.env.COUNT ?? 12);
  for (let round = 1; round <= count; round++) console.log("exit " + (await run()) + " of worker " + round);
} else {
  console.log("worker " + threadId + " begins");
  console.log("worker " + threadId + " ends");
  process.exit(threadId % 3);
}
