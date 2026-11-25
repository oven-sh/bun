// The Worker loads nothing but bun:main, the entry of its own thread, which the build of a test run leaves to the host. Its file is compiled, so the host took that module for one that is compiled with the program and refused it.
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
