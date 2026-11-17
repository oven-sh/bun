// bun:main is the entry of the thread. In a test run the build leaves it to the host. It is no module of Bun's library that a program could name somewhere, so a load of it is not refused.
import { test } from "bun:test";

test("t", async () => {
  const worker = new Worker(new URL("./guest.js", import.meta.url).href);
  const said = await new Promise(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => resolve("an error: " + event.message);
  });
  console.log(said);
  worker.terminate();
});
