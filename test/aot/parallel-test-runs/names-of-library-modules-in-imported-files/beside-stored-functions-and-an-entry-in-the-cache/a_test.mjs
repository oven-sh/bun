import { test } from "bun:test";
import "./hooks.cjs";
test("each way to load a file", async () => {
  await import("./statements.mjs");
  await import("./called.cjs");
  await import("./called.mjs");
  require("./required.cjs");
});
