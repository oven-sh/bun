// When the mock has ended the module is what its run has made of it.
import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./tax", async () => {
    try { return { ...(await import("./tax")) }; } catch (error) { return { rate: "mock rate behind " + error.message }; }
  });
  console.log("a mocked", (await import("./tax")).rate);
  vi.doUnmock("./tax");
  console.log("a real", await import("./tax").then(it => it.rate, error => "caught " + error.message));
});
