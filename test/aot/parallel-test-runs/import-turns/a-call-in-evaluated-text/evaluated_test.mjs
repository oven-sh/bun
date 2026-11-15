// The host makes the call for code that was made at run time. The text comes a turn later for it too.
import { test } from "bun:test";

test("a call in evaluated text comes behind the jobs of the turn", async () => {
  globalThis.jobs = 0;
  let row = Promise.resolve();
  for (let i = 0; i < 100; i++) row = row.then(() => void globalThis.jobs++);
  const { value } = await new Function("return import('./file.mjs')")();
  console.log("imported", value, "behind", globalThis.jobs, "jobs");
});
