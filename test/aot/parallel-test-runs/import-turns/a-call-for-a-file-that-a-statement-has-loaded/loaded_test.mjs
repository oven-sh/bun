// The loader has the file, so the call waits for no text: it settles in the turn of the call, so many jobs behind it, with most of the row still to run.
import { test } from "bun:test";
import "./file.mjs";

test("a call for a file that a statement has loaded waits for no text", async () => {
  globalThis.jobs = 0;
  let row = Promise.resolve();
  for (let i = 0; i < 100; i++) row = row.then(() => void globalThis.jobs++);
  const { value } = await import("./file.mjs");
  console.log("imported", value, "behind", globalThis.jobs, "jobs");
});
