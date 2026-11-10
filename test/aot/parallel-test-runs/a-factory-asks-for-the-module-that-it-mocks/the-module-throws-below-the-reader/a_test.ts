// The body that runs for the load of the factory throws.
import { test, mock } from "bun:test";
mock.module("./tax", async () => {
  try { return { rate: "mock over " + (await import("./reader")).read() }; } catch (error) { return { rate: "mock rate behind " + error.message }; }
});
test("a", async () => { console.log("a", (await import("./tax")).rate); });
