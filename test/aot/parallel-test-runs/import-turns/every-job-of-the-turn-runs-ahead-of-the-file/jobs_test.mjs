// `await import()` beside a row of `.then()`: however long the row, it ends in the turn of the call, and the text comes in a later one.
import { test } from "bun:test";

test("every job of the turn runs ahead of the file", async () => {
  globalThis.jobs = 0;
  let row = Promise.resolve();
  for (let i = 0; i < 100; i++) row = row.then(() => void globalThis.jobs++);
  const { value } = await import("./file.mjs");
  console.log("imported", value, "behind", globalThis.jobs, "jobs");
});
