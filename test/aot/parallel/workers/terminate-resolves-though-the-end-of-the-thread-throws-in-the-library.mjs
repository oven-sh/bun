// At the end of a thread the library first lets go of the URL that the text of the worker was started from. A program has replaced the function that does so by
// one that throws. The promise of terminate() resolves all the same: it has a listener of its own.
import { Worker } from "node:worker_threads";
process.on("uncaughtException", () => {});
const worker = new Worker("setInterval(() => {}, 1000)", { eval: true });
worker.on("online", async () => {
  URL.revokeObjectURL = () => {
    throw new Error("made up");
  };
  const said = await Promise.race([
    worker.terminate().then(() => "terminated"),
    new Promise(done => setTimeout(done, 5000, "never")),
  ]);
  console.log(said);
  process.exit(0);
});
