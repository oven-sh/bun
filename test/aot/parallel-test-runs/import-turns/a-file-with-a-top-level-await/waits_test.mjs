// The file begins in the turn in which its text has come, and the call settles so many jobs behind its last statement.
import { test } from "bun:test";

test("a file that awaits at its top settles the call behind its end", async () => {
  globalThis.jobs = 0;
  globalThis.jobsBehindTheFile = 0;
  let row = Promise.resolve();
  for (let i = 0; i < 100; i++) row = row.then(() => void globalThis.jobs++);
  const { value } = await import("./waits.mjs");
  console.log("imported", value, "|", globalThis.jobsBehindTheFile, "jobs behind the file");
});
