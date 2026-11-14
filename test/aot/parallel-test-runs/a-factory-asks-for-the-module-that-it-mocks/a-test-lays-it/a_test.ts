// A test lays the mock, and the factory asks for the module that it mocks.
import { test, mock } from "bun:test";
test("a", async () => {
  mock.module("./tax", async () => { const real = await import("./tax"); return { rate: "mock of " + real.rate }; });
  console.log("a", (await import("./tax")).rate);
});
