// The file runs in a later turn than the call, and in the jobs of that turn the test goes on and passes: what the file leaves unhandled is charged to the next test.
import { test } from "bun:test";

test("imports a file that leaves a rejection unhandled", async () => {
  queueMicrotask(() => console.log("a job of the test"));
  console.log("imported", (await import("./leaves-a-rejection.ts")).value);
});

test("next", () => console.log("next"));
