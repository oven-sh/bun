import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bench, run } from "../runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const childPath = path.join(__dirname, "ipc-json-child.mjs");

const smallMessage = { type: "ping", id: 1 };
const largeString = Buffer.alloc(10 * 1024 * 1024, "A").toString();
const largeMessage = { type: "ping", id: 1, data: largeString };

async function runBenchmark(message, count) {
  let received = 0;
  const { promise, resolve } = Promise.withResolvers();

  const child = fork(childPath, [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    serialization: "json",
  });

  child.on("message", () => {
    received++;
    if (received >= count) {
      resolve();
    }
  });

  for (let i = 0; i < count; i++) {
    child.send(message);
  }

  await promise;
  child.kill();
}

bench("ipc json - small messages (1000 roundtrips)", async () => {
  await runBenchmark(smallMessage, 1000);
});

bench("ipc json - 10MB messages (10 roundtrips)", async () => {
  await runBenchmark(largeMessage, 10);
});

await run();
