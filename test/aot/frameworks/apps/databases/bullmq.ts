import { Queue, UnrecoverableError, Worker } from "bullmq";

const connection = {
  host: "127.0.0.1",
  port: 1,
  maxRetriesPerRequest: null,
  retryStrategy: () => null,
  enableOfflineQueue: false,
  lazyConnect: true,
};
const queue = new Queue<{ color: string }>("Paint", { connection, defaultJobOptions: { attempts: 3 } });
queue.on("error", () => {});
console.log(
  queue.name,
  queue.toKey("wait"),
  queue.opts.prefix,
  queue.jobsOpts.attempts,
  new UnrecoverableError("x") instanceof Error,
);
const worker = new Worker<{ color: string }>("Paint", async job => job.data.color, { connection, autorun: false });
worker.on("error", () => {});
console.log(worker.name, worker.isRunning(), worker.isPaused(), typeof worker.run);
try {
  await queue.add("cars", { color: "blue" });
} catch (error) {
  console.log((error as Error).message.slice(0, 40));
}
await Promise.race([Promise.allSettled([queue.close(), worker.close(true)]), Bun.sleep(2000)]);
process.exit(0);
