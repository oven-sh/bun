// The loader has the text of a file that is being evaluated: a call for it waits for no turn, only for the end of the file.
import { test } from "bun:test";

test("a call for the file that runs waits for no text", async () => {
  globalThis.jobs = 0;
  globalThis.jobsBehindTheFile = 0;
  let row = Promise.resolve();
  for (let i = 0; i < 100; i++) row = row.then(() => void globalThis.jobs++);
  const self = await import("./self.mjs");
  console.log("imported:", self.state, "|", globalThis.jobsBehindTheFile, "jobs behind the file");
  await globalThis.hasItself;
});
