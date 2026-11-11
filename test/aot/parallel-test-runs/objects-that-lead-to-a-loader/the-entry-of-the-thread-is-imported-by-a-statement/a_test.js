// bun:main is an ES module of the host's without exports. Compiled code took what the host answers for a value, as with a module of Bun's library, and gave the namespace a `default` that holds it.
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
