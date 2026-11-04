// The statements of a test file name their modules to the loader: see the first folder. The whole graph of the test file is loaded when its first file runs, "ws" below the second statement too.
import "./first";
import "./second";
import { test, vi } from "bun:test";
test("t", () => {
  if (process.env.NOBODY_SETS_THIS) vi.resetModules();
});
