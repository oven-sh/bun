import { test, expect } from "bun:test";
test("the function starts the file on a thread of its own", async () => {
  const { default: Made } = await import("./job.mjs?worker");
  const worker = new Made();
  const said = await new Promise((resolve) => { worker.onmessage = (event) => resolve("says " + event.data); worker.onerror = () => resolve("fails"); });
  worker.terminate();
  console.log(said);
  expect(said).toBe("says main thread: false");
});
