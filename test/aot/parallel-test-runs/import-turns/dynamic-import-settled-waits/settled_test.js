// vi.dynamicImportSettled() waits for a call that nobody holds the promise of, to the end of a file that awaits a timer.
import { test, vi } from "bun:test";

test("waits for a call that nobody awaits", async () => {
  import("./waits.js");
  await vi.dynamicImportSettled();
  console.log("settled:", globalThis.waited);
});
