// The call is rejected so many jobs behind the throw, in the turn in which the text has come.
import { test } from "bun:test";

test("a file that throws rejects the call", async () => {
  globalThis.jobs = 0;
  globalThis.jobsBehindTheFile = 0;
  let row = Promise.resolve();
  for (let i = 0; i < 100; i++) row = row.then(() => void globalThis.jobs++);
  const error = await import("./throws.mjs").then(
    () => null,
    error => error,
  );
  console.log("rejected with:", error?.message, "|", globalThis.jobsBehindTheFile, "jobs behind the file");
});
