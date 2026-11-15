// The body that runs for the factory throws, and the factory hears of it.
import { test, mock } from "bun:test";
mock.module("./tax", async () => {
  try { return { ...(await import("./tax")) }; } catch (error) { return { rate: "mock rate behind " + error.message }; }
});
test("a", async () => { console.log("a", (await import("./tax")).rate); });
